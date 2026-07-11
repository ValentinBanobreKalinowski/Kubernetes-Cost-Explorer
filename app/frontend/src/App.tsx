import { useState, useEffect } from 'react';
import './App.css';
import NodeCard, { type NodeInfo } from './NodeCard';
import ClusterSummary, { type ClusterSummaryData, type Theme } from './ClusterSummary';
import CostHistory from './CostHistory';

interface ClusterResponse extends ClusterSummaryData {
  timestamp: string;
  nodes: NodeInfo[];
}

interface ErrorResponse {
  error: string;
}

const REFRESH_INTERVAL_SECONDS = 15; // k8s metrics API has a 15s scrape interval, so this is a good balance between freshness and load.
const THEME_STORAGE_KEY = 'theme';

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark'
    ? stored
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}

function App() {
  const [data, setData] = useState<ClusterResponse | ErrorResponse | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_SECONDS);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const fetchCluster = () => {
      fetch('/api/cluster')
        .then((res) => res.json())
        .then((json) => setData(json))
        .catch((err) => console.error(err));
    };

    // derived from Date.now() so a page refresh doesn't reset the phase
    let lastFetchedBoundary = -1;

    const tick = () => {
      const nowSeconds = Date.now() / 1000;
      const secondsIntoWindow = nowSeconds % REFRESH_INTERVAL_SECONDS;
      setSecondsUntilRefresh(Math.ceil(REFRESH_INTERVAL_SECONDS - secondsIntoWindow));

      const currentBoundary = Math.floor(nowSeconds / REFRESH_INTERVAL_SECONDS);
      if (currentBoundary !== lastFetchedBoundary) {
        lastFetchedBoundary = currentBoundary;
        fetchCluster();
      }
    };

    tick();
    const clockInterval = setInterval(tick, 1000);

    return () => clearInterval(clockInterval);
  }, []);

  if (!data) {
    return <div className="dashboard">Loading...</div>;
  }

  if ('error' in data) {
    return <div className="dashboard error">{data.error}</div>;
  }

  return (
    <>
      <div className="page">
        <div className="node-grid">
          {data.nodes.map((node) => (
            <NodeCard key={node.name} node={node} />
          ))}
        </div>

        <div className="summary-divider" />

        <ClusterSummary
          data={data}
          secondsUntilRefresh={secondsUntilRefresh}
          theme={theme}
          onThemeChange={setTheme}
        />
      </div>

      <CostHistory />
    </>
  );
}

export default App;
