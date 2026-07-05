import express, { Request, Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import https from 'https';

const app = express();
const PORT = 3000;

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
        ownerReferences?: { kind: string; name: string }[];
    };
    spec: {
        nodeName?: string;
    };
}

interface NodeMetrics {
    metadata: { name: string };
    usage: { cpu: string };
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


app.get('/api/cluster', async (req: Request, res: Response) => {
    try {
        const nodesRes = await k8sClient.get<K8sList<K8sNode>>(`${K8S_API}/api/v1/nodes`);
        const podsRes = await k8sClient.get<K8sList<K8sPod>>(`${K8S_API}/api/v1/pods`);
        const metricsRes = await k8sClient.get<K8sList<NodeMetrics>>(`${K8S_API}/apis/metrics.k8s.io/v1beta1/nodes`);

        const cpuUsageByNode: Record<string, number> = {};
        for (const metric of metricsRes.data.items) {
            cpuUsageByNode[metric.metadata.name] = parseCpuToMillicores(metric.usage.cpu);
        }

        const podsByNode: Record<string, K8sPod[]> = {};
        for (const pod of podsRes.data.items) {
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

// Start HTTP server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
