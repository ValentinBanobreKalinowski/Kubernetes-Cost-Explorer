import { useState, useEffect } from 'react';
import './App.css';
import NodeCard, { type NodeInfo } from './NodeCard';
import ClusterSummary, { type ClusterSummaryData } from './ClusterSummary';

interface ClusterResponse extends ClusterSummaryData {
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
    const interval = setInterval(fetchCluster, 15000); // Refresh every 15 seconds, k8s metrics API has a 15s scrape interval, so this is a good balance between freshness and load.
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
      <div className="node-grid">
        {data.nodes.map((node) => (
          <NodeCard key={node.name} node={node} />
        ))}
      </div>

      <div className="summary-divider" />

      <ClusterSummary data={data} />
    </div>
  );
}

export default App;
