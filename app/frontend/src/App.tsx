import { useState, useEffect } from 'react';
import './App.css';
import NodeCard, { type NodeInfo } from './NodeCard';

interface ClusterResponse {
  clusterName: string;
  timestamp: string;
  nodes: NodeInfo[];
}

interface ErrorResponse {
  error: string;
}

function App() {
  const [data, setData] = useState<ClusterResponse | ErrorResponse | null>(null);

  useEffect(() => {
    const fetchCluster = () => {
      fetch('/api/cluster')
        .then((res) => res.json())
        .then((json) => setData(json))
        .catch((err) => console.error(err));
    };

    fetchCluster();
    const interval = setInterval(fetchCluster, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return <div className="dashboard">Loading...</div>;
  }

  if ('error' in data) {
    return <div className="dashboard error">{data.error}</div>;
  }

  return (
    <div className="page">
      <div className="summary">
        <div className="stat">Cluster: <strong>{data.clusterName}</strong></div>
        <div className="timestamp">Last update: {data.timestamp}</div>
      </div>

      <div className="node-grid">
        {data.nodes.map((node) => (
          <NodeCard key={node.name} node={node} />
        ))}
      </div>
    </div>
  );
}

export default App;
