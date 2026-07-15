import express, { Request, Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import https from 'https';
import { Pool } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';


const app = express();
const PORT = 3000;

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    // RDS enforces SSL by default; the in-cluster dev Postgres doesn't support it.
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// For now we'll hardcode the cost rates, but when its deployed to aws we will get real data.
const CPU_HOUR_RATE = Number(process.env.CPU_HOUR_RATE ?? 0.03);
const MEMORY_GB_HOUR_RATE = Number(process.env.MEMORY_GB_HOUR_RATE ?? 0.004);
const SNAPSHOT_INTERVAL_MS = 15 * 1000;
const REPORT_INTERVAL_MS = 60 * 60 * 1000; // Each hour
const S3_REPORTS_BUCKET = process.env.S3_REPORTS_BUCKET;
const s3Client = S3_REPORTS_BUCKET ? new S3Client{{ region: process.env.AWS_REGION }} : null

async function initDb(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cost_snapshots (
            id SERIAL PRIMARY KEY,
            snapshot_time TIMESTAMPTZ NOT NULL,
            namespace TEXT NOT NULL,
            pod_count INTEGER NOT NULL,
            cpu_request_millicores INTEGER NOT NULL,
            memory_request_ki INTEGER NOT NULL,
            estimated_hourly_cost NUMERIC(10, 4) NOT NULL
        );
    `);
    // dedups inserts across replicas for the same tick
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS cost_snapshots_namespace_time_idx
        ON cost_snapshots (namespace, snapshot_time);
    `);
    console.log('Postgres ready: cost_snapshots table present.');
}

// Internal Kubernetes API cluster address
const K8S_API = 'https://kubernetes.default.svc';

// Read the credentials that Kubernetes automatically injects into running pods
const TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

interface K8sList<T> {
    items: T[];
}

interface K8sNode {
    metadata: {
        name: string;
        labels?: Record<string, string>;
    };
}

interface K8sPod {
    metadata: {
        name: string;
        namespace: string;
        ownerReferences?: { kind: string; name: string }[];
    };
    spec: {
        nodeName?: string;
        containers: {
            resources?: {
                requests?: { cpu?: string; memory?: string };
            };
        }[];
    };
}

interface NamespaceSnapshot {
    namespace: string;
    podCount: number;
    cpuRequestMillicores: number;
    memoryRequestKi: number;
    estimatedHourlyCost: number;
}

interface NodeMetrics {
    metadata: { name: string };
    usage: { cpu: string; memory: string };
}

interface NodeInfo {
    name: string;
    role: 'control-plane' | 'worker';
    cpuUsageMillicores: number;
    podCounts: Record<string, number>;
}

let k8sClient: AxiosInstance = axios;

if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CA_PATH)) {
    const token = fs.readFileSync(TOKEN_PATH, 'utf8');
    k8sClient = axios.create({
        baseURL: K8S_API,
        headers: {
            Authorization: `Bearer ${token}`
        },
        httpsAgent: new https.Agent({
            ca: fs.readFileSync(CA_PATH)
        })
    });
    console.log('Configured authenticated cluster client using ServiceAccount token.');
} else {
    console.warn('ServiceAccount files not found. Falling back to unauthenticated axios (local/proxy testing).');
}

function isControlPlane(node: K8sNode): boolean {
    const labels = node.metadata.labels ?? {};
    return 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels;
}

// Pods are owned by a ReplicaSet named "<deployment>-<hash>"
function getWorkloadName(pod: K8sPod): string {
    const owner = pod.metadata.ownerReferences?.[0];
    if (!owner) return pod.metadata.name;
    if (owner.kind === 'ReplicaSet') return owner.name.replace(/-[a-z0-9]+$/, '');
    return owner.name;
}

function parseCpuToMillicores(cpu: string): number {
    if (cpu.endsWith('n')) return Math.round(parseInt(cpu, 10) / 1e6);
    if (cpu.endsWith('m')) return parseInt(cpu, 10);
    return Math.round(parseFloat(cpu) * 1000);
}

// metrics.k8s.io reports memory as e.g. "123456Ki"; normalize everything to Ki.
function parseMemoryToKi(memory: string): number {
    if (memory.endsWith('Ki')) return parseInt(memory, 10);
    if (memory.endsWith('Mi')) return parseInt(memory, 10) * 1024;
    if (memory.endsWith('Gi')) return parseInt(memory, 10) * 1024 * 1024;
    return Math.round(parseInt(memory, 10) / 1024);
}

function computeNamespaceSnapshots(pods: K8sPod[]): NamespaceSnapshot[] {
    const byNamespace: Record<string, { podCount: number; cpuRequestMillicores: number; memoryRequestKi: number }> = {};

    for (const pod of pods) {
        const ns = pod.metadata.namespace;
        const entry = (byNamespace[ns] ??= { podCount: 0, cpuRequestMillicores: 0, memoryRequestKi: 0 });
        entry.podCount++;

        for (const container of pod.spec.containers) {
            const requests = container.resources?.requests;
            if (requests?.cpu) entry.cpuRequestMillicores += parseCpuToMillicores(requests.cpu);
            if (requests?.memory) entry.memoryRequestKi += parseMemoryToKi(requests.memory);
        }
    }

    return Object.entries(byNamespace).map(([namespace, entry]) => {
        const cpuCores = entry.cpuRequestMillicores / 1000;
        const memoryGi = entry.memoryRequestKi / (1024 * 1024);
        const estimatedHourlyCost = cpuCores * CPU_HOUR_RATE + memoryGi * MEMORY_GB_HOUR_RATE;
        return { namespace, ...entry, estimatedHourlyCost };
    });
}

async function takeSnapshot(): Promise<void> {
    try {
        const podsRes = await k8sClient.get<K8sList<K8sPod>>(`${K8S_API}/api/v1/pods`);
        const snapshots = computeNamespaceSnapshots(podsRes.data.items);
        const bucketedTime = new Date(Math.floor(Date.now() / SNAPSHOT_INTERVAL_MS) * SNAPSHOT_INTERVAL_MS);

        for (const snap of snapshots) {
            await pool.query(
                `INSERT INTO cost_snapshots (snapshot_time, namespace, pod_count, cpu_request_millicores, memory_request_ki, estimated_hourly_cost)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (namespace, snapshot_time) DO NOTHING`,
                [bucketedTime, snap.namespace, snap.podCount, snap.cpuRequestMillicores, snap.memoryRequestKi, snap.estimatedHourlyCost]
            );
        }
        console.log(`Snapshot saved: ${snapshots.length} namespace(s).`);
    } catch (err: any) {
        console.error('Snapshot failed:', err.message);
    }
}

async function generateHourlyReport(): Promise<void> {
    if (!s3Client) return; 
    try {
        const result = await pool.query<{ namespace: string; avg_hourly_cost: number; snapshot_count: string}>(
            `SELECT namespace, AVG(estimated_hourly_cost)::double precision AS avg_hourly_cost,
            COUNT(*) AS snapshot_count FROM cost_snapshots WHERE snapshot_time > now() - interval '1 hour' GROUP BY namespace ORDER BY namespace`
        );

        const windowEnd = new Date();
        const report = {
            generatedAt: windowEnd.toISOString(),
            windowStart: new Date(windowEnd.getTime() - REPORT_INTERVAL_MS).toISOString(),
            windowEnd: windowEnd.toISOString(),
            namespaces: result.rows.map((row) => ({
                namespace: row.namespace,
                avgHourlyCost: row.avg_hourly_cost,
                snapshotCount: Number(row.snapshot_count)
            }))
        };

         await s3Client.send(new PutObjectCommand({
            Bucket: S3_REPORTS_BUCKET,
            Key: `reports/hourly/${windowEnd.toISOString()}.json`,
            Body: JSON.stringify(report, null, 2),
            ContentType: 'application/json'
        }));
         console.log(`Hourly report uploaded to s3://${S3_REPORTS_BUCKET}: ${report.namespaces.length} namespace(s).`);
    } catch (err: any) {
        console.error('Hourly report failed:', err.message);
}

app.get('/api/cluster', async (req: Request, res: Response) => {
    try {
        const nodesRes = await k8sClient.get<K8sList<K8sNode>>(`${K8S_API}/api/v1/nodes`);
        const podsRes = await k8sClient.get<K8sList<K8sPod>>(`${K8S_API}/api/v1/pods`);
        const metricsRes = await k8sClient.get<K8sList<NodeMetrics>>(`${K8S_API}/apis/metrics.k8s.io/v1beta1/nodes`);

        const cpuUsageByNode: Record<string, number> = {};
        let totalCpuMillicores = 0;
        let totalMemoryKi = 0;
        for (const metric of metricsRes.data.items) {
            const cpu = parseCpuToMillicores(metric.usage.cpu);
            cpuUsageByNode[metric.metadata.name] = cpu;
            totalCpuMillicores += cpu;
            totalMemoryKi += parseMemoryToKi(metric.usage.memory);
        }

        const podsByNode: Record<string, K8sPod[]> = {};
        let frontendPods = 0;
        let backendPods = 0;
        for (const pod of podsRes.data.items) {
            const workload = getWorkloadName(pod);
            if (workload === 'cost-explorer-frontend-deployment') frontendPods++;
            if (workload === 'cost-explorer-backend-deployment') backendPods++;

            const nodeName = pod.spec.nodeName;
            if (!nodeName) continue;
            (podsByNode[nodeName] ??= []).push(pod);
        }

        const nodes: NodeInfo[] = nodesRes.data.items.map((node) => {
            const podCounts: Record<string, number> = {};
            for (const pod of podsByNode[node.metadata.name] ?? []) {
                const workload = getWorkloadName(pod);
                podCounts[workload] = (podCounts[workload] ?? 0) + 1;
            }

            return {
                name: node.metadata.name,
                role: isControlPlane(node) ? 'control-plane' : 'worker',
                cpuUsageMillicores: cpuUsageByNode[node.metadata.name] ?? 0,
                podCounts
            };
        });

        res.json({
            clusterName: 'k3d-project-cluster',
            nodesCount: nodesRes.data.items.length,
            podsCount: podsRes.data.items.length,
            totalCpuMillicores,
            totalMemoryKi,
            frontendPods,
            backendPods,
            timestamp: new Date().toLocaleTimeString(),
            nodes
        });

    } catch (err: any) {
        console.error('K8S ERROR:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data
        });

        res.status(500).json({
            error: err.message,
            k8sStatus: err.response?.status,
            k8sData: err.response?.data
        });
    }
});

app.get('/api/cost-history', async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT snapshot_time, namespace, pod_count, cpu_request_millicores, memory_request_ki,
                    estimated_hourly_cost::double precision AS estimated_hourly_cost
             FROM cost_snapshots
             WHERE snapshot_time > now() - interval '15 minutes'
             ORDER BY snapshot_time ASC`
        );
        res.json(result.rows);
    } catch (err: any) {
        console.error('Cost history query failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Start HTTP server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

initDb()
    .then(() => {
        // align to the wall-clock grid so replicas snapshot in sync
        const msUntilNextBoundary = SNAPSHOT_INTERVAL_MS - (Date.now() % SNAPSHOT_INTERVAL_MS);
        setTimeout(() => {
            takeSnapshot();
            setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS);
        }, msUntilNextBoundary);
    })
    .catch((err) => console.error('Failed to initialize database:', err.message));
