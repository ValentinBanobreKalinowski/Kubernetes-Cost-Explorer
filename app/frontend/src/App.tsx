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

const REFRESH_INTERVAL_SECONDS = 15; // k8s metrics API has a 15s scrape interval, so this is a good balance between freshness and load.

function App() {
  const [data, setData] = useState<ClusterResponse | ErrorResponse | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_SECONDS);

  useEffect(() => {
    const fetchCluster = () => {
      fetch('/api/cluster')
        .then((res) => res.json())
        .then((json) => setData(json))
        .catch((err) => console.error(err));
      setSecondsUntilRefresh(REFRESH_INTERVAL_SECONDS);
    };

    fetchCluster();
    const refreshInterval = setInterval(fetchCluster, REFRESH_INTERVAL_SECONDS * 1000);
    const countdownInterval = setInterval(() => {
      setSecondsUntilRefresh((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
    };
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

      <ClusterSummary data={data} secondsUntilRefresh={secondsUntilRefresh} />
    </div>
  );
}

export default App;
