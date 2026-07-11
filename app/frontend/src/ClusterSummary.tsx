export interface ClusterSummaryData {
  clusterName: string;
  totalCpuMillicores: number;
  totalMemoryKi: number;
  nodesCount: number;
  frontendPods: number;
  backendPods: number;
}

export type Theme = 'light' | 'dark';

function formatCpu(millicores: number): string {
  return millicores >= 1000 ? `${(millicores / 1000).toFixed(2)} cores` : `${millicores}m`;
}

function formatMemory(ki: number): string {
  return ki >= 1024 * 1024 ? `${(ki / 1024 / 1024).toFixed(2)} Gi` : `${(ki / 1024).toFixed(0)} Mi`;
}

interface ClusterSummaryProps {
  data: ClusterSummaryData;
  secondsUntilRefresh: number;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

function ClusterSummary({ data, secondsUntilRefresh, theme, onThemeChange }: ClusterSummaryProps) {
  return (
    <div className="cluster-summary">
      <div className="summary-line">Cluster: <strong>{data.clusterName}</strong></div>
      <div className="summary-line">Total CPU usage: <strong>{formatCpu(data.totalCpuMillicores)}</strong></div>
      <div className="summary-line">Total memory usage: <strong>{formatMemory(data.totalMemoryKi)}</strong></div>
      <div className="summary-line">Amount of nodes: <strong>{data.nodesCount}</strong></div>
      <div className="summary-line">Frontend pods: <strong>{data.frontendPods}</strong></div>
      <div className="summary-line">Backend pods: <strong>{data.backendPods}</strong></div>
      <div className="summary-line refresh-timer">Next refresh in: <strong>{secondsUntilRefresh}s</strong></div>

      <div className="theme-switch">
        <button className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>
          Light
        </button>
        <button className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>
          Dark
        </button>
      </div>
    </div>
  );
}

export default ClusterSummary;
