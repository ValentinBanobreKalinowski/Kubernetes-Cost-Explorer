export interface NodeInfo {
  name: string;
  role: 'control-plane' | 'worker';
  cpuUsageMillicores: number;
  podCounts: Record<string, number>;
}

function formatCpu(millicores: number): string {
  return millicores >= 1000 ? `${(millicores / 1000).toFixed(2)} cores` : `${millicores}m`;
}

function NodeCard({ node }: { node: NodeInfo }) {
  const deployments = Object.entries(node.podCounts);

  return (
    <div className="node-card">
      <div className="node-card-header">
        <span className="node-name">{node.name}</span>
        <span className={`role-badge ${node.role}`}>
          {node.role === 'control-plane' ? 'Control Plane' : 'Worker'}
        </span>
      </div>

      <div className="node-cpu">
        CPU usage: <strong>{formatCpu(node.cpuUsageMillicores)}</strong>
      </div>

      <div className="node-pods">
        {deployments.length === 0 ? (
          <div className="node-pods-empty">No pods running</div>
        ) : (
          <ul>
            {deployments.map(([deployment, count]) => (
              <li key={deployment}>
                <span>{deployment}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NodeCard;
