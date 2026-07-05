import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState<any>(null);

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

  if (data.error) {
    return <div className="dashboard error">{data.error}</div>;
  }

  return (
    <div className="dashboard">
      <div className="stat">Cluster: <strong>{data.clusterName}</strong></div>
      <div className="stat">Nodes: <strong>{data.nodesCount}</strong></div>
      <div className="stat">Pods: <strong>{data.podsCount}</strong></div>
      <div className="timestamp">Last update: {data.timestamp}</div>
    </div>
  );
}

export default App;
