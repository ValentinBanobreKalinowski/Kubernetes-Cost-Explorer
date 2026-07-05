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

interface K8sList {
    items: unknown[];
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

/**
 * API endpoint exposed to the frontend.
 * Provides aggregated cluster metrics matching frontend keys.
 */
app.get('/api/cluster', async (req: Request, res: Response) => {
    try {
        const nodesRes = await k8sClient.get<K8sList>(`${K8S_API}/api/v1/nodes`);
        const podsRes = await k8sClient.get<K8sList>(`${K8S_API}/api/v1/pods`);

        res.json({
            clusterName: 'k3d-project-cluster',
            nodesCount: nodesRes.data.items.length,
            podsCount: podsRes.data.items.length,
            timestamp: new Date().toLocaleTimeString()
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
