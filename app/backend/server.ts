import express, { Request, Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import https from 'https';
import { Pool } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Signer } from '@aws-sdk/rds-signer'
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing'


const app = express();
const PORT = 3000;

const POSTGRES_HOST = process.env.POSTGRES_HOST;
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const POSTGRES_USER = process.env.POSTGRES_USER;

// On EKS the backend authenticates to RDS with a short-lived IAM token
// (via its IRSA role) instead of a static password. Local/k3d dev keeps the
// static POSTGRES_PASSWORD since there's no IAM identity to sign tokens with.
const iamSigner = process.env.POSTGRES_IAM_AUTH === 'true'
    ? new Signer({ hostname: POSTGRES_HOST!, port: POSTGRES_PORT, username: POSTGRES_USER!, region: process.env.AWS_REGION })
    : null;

const pool = new Pool({
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    user: POSTGRES_USER,
    password: iamSigner ? () => iamSigner.getAuthToken() : process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    // RDS enforces SSL by default; the in-cluster dev Postgres doesn't support it.
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// Fallback flat rates - used for local/k3d dev (no real EC2 instance types to
// price) and as a safety net if a node's instance type can't be priced via
// the AWS Pricing API. On EKS, real per-node pricing takes over instead (see
// getInstanceHourlyPrice/buildNodePricing below).
const CPU_HOUR_RATE = Number(process.env.CPU_HOUR_RATE ?? 0.03);
const MEMORY_GB_HOUR_RATE = Number(process.env.MEMORY_GB_HOUR_RATE ?? 0.004);
const SNAPSHOT_INTERVAL_MS = 15 * 1000;
const REPORT_INTERVAL_MINUTES = Number(process.env.REPORT_INTERVAL_MINUTES ?? 60);
const REPORT_INTERVAL_MS = REPORT_INTERVAL_MINUTES * 60 * 1000;

const S3_REPORTS_BUCKET = process.env.S3_REPORTS_BUCKET;
const s3Client = S3_REPORTS_BUCKET ? new S3Client({ region: process.env.AWS_REGION }) : null

// The AWS Pricing API is only served out of us-east-1 (and ap-south-1),
// regardless of which region the priced resources actually live in - the
// region we're pricing for is passed as a request filter instead, below.
const PRICING_API_REGION = 'us-east-1';
const PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // on-demand EC2 pricing rarely changes intraday
const pricingClient = process.env.AWS_REGION ? new PricingClient({ region: PRICING_API_REGION }) : null;
const instancePriceCache = new Map<string, { hourlyPriceUsd: number; fetchedAt: number }>();

// Arbitrary fixed key for a session-level advisory lock - serializes the
// schema creation below across replicas. CREATE TABLE/INDEX IF NOT EXISTS
// isn't safe against concurrent DDL: multiple replicas starting at once can
// each see "doesn't exist" and race to create it, and the loser errors with
// "duplicate key value violates unique constraint pg_class_relname_nsp_index".
const INIT_DB_LOCK_KEY = 676767;

async function initDb(): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [INIT_DB_LOCK_KEY]);
        await client.query(`
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
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS cost_snapshots_namespace_time_idx
            ON cost_snapshots (namespace, snapshot_time);
        `);
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [INIT_DB_LOCK_KEY]);
        client.release();
    }
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
    status?: {
        allocatable?: { cpu?: string; memory?: string };
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

interface NodePricing {
    hourlyPriceUsd: number;
    allocatableCpuMillicores: number;
    allocatableMemoryKi: number;
}

// Looks up the real AWS on-demand hourly price for an EC2 instance type,
// cached since pricing barely moves and we'd otherwise hit this every
// snapshot tick. Returns null (falling back to the flat rate) if there's no
// pricing client (no AWS_REGION - local/k3d dev) or no matching product,
// which also naturally covers non-EC2 instance types like k3d's "k3s".
async function getInstanceHourlyPrice(instanceType: string): Promise<number | null> {
    const cached = instancePriceCache.get(instanceType);
    if (cached && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) return cached.hourlyPriceUsd;

    if (!pricingClient) return null;
    try {
        const res = await pricingClient.send(new GetProductsCommand({
            ServiceCode: 'AmazonEC2',
            Filters: [
                { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
                { Type: 'TERM_MATCH', Field: 'regionCode', Value: process.env.AWS_REGION! },
                { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
                { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
                { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
                { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
            ],
            MaxResults: 1,
        }));

        const raw = res.PriceList?.[0];
        if (!raw) {
            console.warn(`No AWS Pricing data for instance type ${instanceType} - falling back to flat rate.`);
            return null;
        }

        const product = JSON.parse(raw as string);
        const onDemandTerm: any = Object.values(product.terms.OnDemand)[0];
        const priceDimension: any = Object.values(onDemandTerm.priceDimensions)[0];
        const hourlyPriceUsd = parseFloat(priceDimension.pricePerUnit.USD);

        instancePriceCache.set(instanceType, { hourlyPriceUsd, fetchedAt: Date.now() });
        return hourlyPriceUsd;
    } catch (err: any) {
        console.error(`AWS Pricing lookup failed for ${instanceType}:`, err.message);
        return null;
    }
}

// Builds a nodeName -> pricing map for every node currently in the cluster,
// so pods can be costed against the real price of the instance type they're
// actually scheduled on.
async function buildNodePricing(nodes: K8sNode[]): Promise<Record<string, NodePricing>> {
    const result: Record<string, NodePricing> = {};

    await Promise.all(nodes.map(async (node) => {
        const instanceType = node.metadata.labels?.['node.kubernetes.io/instance-type'];
        const allocatable = node.status?.allocatable;
        if (!instanceType || !allocatable?.cpu || !allocatable?.memory) return;

        const hourlyPriceUsd = await getInstanceHourlyPrice(instanceType);
        if (hourlyPriceUsd === null) return;

        result[node.metadata.name] = {
            hourlyPriceUsd,
            allocatableCpuMillicores: parseCpuToMillicores(allocatable.cpu),
            allocatableMemoryKi: parseMemoryToKi(allocatable.memory),
        };
    }));

    return result;
}

function computeNamespaceSnapshots(pods: K8sPod[], nodePricing: Record<string, NodePricing>): NamespaceSnapshot[] {
    const byNamespace: Record<string, { podCount: number; cpuRequestMillicores: number; memoryRequestKi: number; estimatedHourlyCost: number }> = {};

    for (const pod of pods) {
        const ns = pod.metadata.namespace;
        const entry = (byNamespace[ns] ??= { podCount: 0, cpuRequestMillicores: 0, memoryRequestKi: 0, estimatedHourlyCost: 0 });
        entry.podCount++;

        let podCpuMillicores = 0;
        let podMemoryKi = 0;
        for (const container of pod.spec.containers) {
            const requests = container.resources?.requests;
            if (requests?.cpu) podCpuMillicores += parseCpuToMillicores(requests.cpu);
            if (requests?.memory) podMemoryKi += parseMemoryToKi(requests.memory);
        }
        entry.cpuRequestMillicores += podCpuMillicores;
        entry.memoryRequestKi += podMemoryKi;

        const node = pod.spec.nodeName ? nodePricing[pod.spec.nodeName] : undefined;
        if (node) {
            // Dominant-resource share: charge the pod for whichever request
            // (cpu or memory) claims the larger fraction of the node, since
            // that's the resource that actually gates how much else can be
            // packed onto it.
            const cpuShare = podCpuMillicores / node.allocatableCpuMillicores;
            const memoryShare = podMemoryKi / node.allocatableMemoryKi;
            entry.estimatedHourlyCost += node.hourlyPriceUsd * Math.max(cpuShare, memoryShare);
        } else {
            // Unscheduled pod, or its node's instance type has no AWS
            // Pricing match (e.g. local k3d dev) - use the flat rate.
            entry.estimatedHourlyCost += (podCpuMillicores / 1000) * CPU_HOUR_RATE + (podMemoryKi / (1024 * 1024)) * MEMORY_GB_HOUR_RATE;
        }
    }

    return Object.entries(byNamespace).map(([namespace, entry]) => ({ namespace, ...entry }));
}

async function takeSnapshot(): Promise<void> {
    try {
        const [podsRes, nodesRes] = await Promise.all([
            k8sClient.get<K8sList<K8sPod>>(`${K8S_API}/api/v1/pods`),
            k8sClient.get<K8sList<K8sNode>>(`${K8S_API}/api/v1/nodes`),
        ]);
        const nodePricing = await buildNodePricing(nodesRes.data.items);
        const snapshots = computeNamespaceSnapshots(podsRes.data.items, nodePricing);
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

// Separate advisory lock key from INIT_DB_LOCK_KEY - all replicas fire this
// on the same wall-clock-aligned timer, so without electing a single winner
// each replica uploads its own near-duplicate report every tick.
const REPORT_LOCK_KEY = 676768;

async function generateHourlyReport(): Promise<void> {
    if (!s3Client) return;
    const client = await pool.connect();
    try {
        const { rows: [{ locked }] } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [REPORT_LOCK_KEY]);
        if (!locked) return; // another replica already won this tick

        const result = await client.query<{ namespace: string; avg_hourly_cost: number; snapshot_count: string}>(
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
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [REPORT_LOCK_KEY]);
        client.release();
    }
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
            clusterName: 'valentin-eks-cluster',
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

        if (s3Client) {
            const msUntilNextReportBoundary = REPORT_INTERVAL_MS - (Date.now() % REPORT_INTERVAL_MS);
            setTimeout(() => {
                generateHourlyReport();
                setInterval(generateHourlyReport, REPORT_INTERVAL_MS);
            }, msUntilNextReportBoundary);
        } else {
            console.warn('S3_REPORTS_BUCKET not set - hourly cost reports disabled.');
        }
    })
    .catch((err) => console.error('Failed to initialize database:', err.message));