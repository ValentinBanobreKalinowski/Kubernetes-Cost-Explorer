const express = require('express');
const axios = require('axios');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

// Internal Kubernetes API cluster address
const K8S_API = "https://kubernetes.default.svc";

// Read the credentials that Kubernetes automatically injects into running pods
const TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

let k8sClient = axios;

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
    console.log("Configured authenticated cluster client using ServiceAccount token.");
} else {
    console.warn("ServiceAccount files not found. Falling back to unauthenticated axios (local/proxy testing).");
}

/**
 * API endpoint exposed to the frontend.
 * Provides aggregated cluster metrics matching frontend keys.
 */
app.get('/api/cluster', async (req, res) => {
    try {
        const nodesRes = await k8sClient.get(`${K8S_API}/api/v1/nodes`);
        const podsRes = await k8sClient.get(`${K8S_API}/api/v1/pods`);

        res.json({
            clusterName: "k3d-project-cluster",
            nodesCount: nodesRes.data.items.length,
            podsCount: podsRes.data.items.length,
            timestamp: new Date().toLocaleTimeString()
        });

    } catch (err) {
        console.error("K8S ERROR:", {
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

/**
 * Renders the dashboard UI.
 * The frontend polls /api/cluster every 2 seconds.
 */
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cluster Dashboard</title>

<style>
body {
    font-family: Arial, sans-serif;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    margin: 0;
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.card {
    background: rgba(255, 255, 255, 0.1);
    padding: 40px;
    border-radius: 12px;
    min-width: 420px;
    backdrop-filter: blur(10px);
    text-align: center;
}

h1 {
    margin-bottom: 20px;
    font-size: 28px;
}

.stat {
    margin: 10px 0;
    font-size: 18px;
}

.timestamp {
    margin-top: 20px;
    font-size: 12px;
    opacity: 0.7;
}
</style>
</head>

<body>
<div class="card">
    <h1>Kubernetes Cluster Dashboard</h1>

    <div class="stat">Cluster: <span id="cluster">-</span></div>
    <div class="stat">Nodes: <span id="nodes">-</span></div>
    <div class="stat">Pods: <span id="pods">-</span></div>

    <div class="timestamp">Last update: <span id="time">-</span></div>
</div>

<script>
/**
 * Fetches cluster data from backend API and updates DOM.
 */
async function updateDashboard() {
    try {
        const response = await fetch('/api/cluster');
        const data = await response.json();

        if (data.error) {
            document.getElementById('cluster').textContent = "Error fetching data";
            return;
        }

        document.getElementById('cluster').textContent = data.clusterName;
        document.getElementById('nodes').textContent = data.nodesCount;
        document.getElementById('pods').textContent = data.podsCount;
        document.getElementById('time').textContent = data.timestamp;
    } catch (error) {
        console.error('Failed to fetch cluster data:', error);
    }
}

/**
 * Initial data load.
 */
updateDashboard();

/**
 * Periodic refresh interval (2 seconds).
 */
setInterval(updateDashboard, 2000);
</script>

</body>
</html>
    `);
});

// Start HTTP server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});