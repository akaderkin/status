import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api";

type Node = {
  id: string; name: string; location: string; online: boolean; enabled: boolean;
  lastHeartbeat: string | null; hostname: string | null; version: string | null;
  _count?: { checks: number };
  token?: string;
};

const defaultApiUrl = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : "http://localhost:3000";

export function NodesPage() {
  const [rows, setRows] = useState<Node[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("istanbul");
  const [apiUrl, setApiUrl] = useState(defaultApiUrl);
  const [created, setCreated] = useState<{ node: Node; token: string } | null>(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ binaries: Array<{ os?: string; arch?: string; available: boolean }> } | null>(null);

  const installCmd = useMemo(() => {
    if (!created) return "";
    return `curl -fsSL "${apiUrl}/v1/agent/install.sh" | sudo bash -s -- --api-url "${apiUrl}" --token "${created.token}"`;
  }, [created, apiUrl]);

  const dockerCmd = useMemo(() => {
    if (!created) return "";
    return `docker run -d --name status-agent-${created.node.location} --restart=always \\\n  -e STATUS_API_URL=${apiUrl} \\\n  -e NODE_TOKEN=${created.token} \\\n  status-agent`;
  }, [created, apiUrl]);

  async function load() {
    const [nodes, agentMeta] = await Promise.all([
      api<Node[]>("/admin/nodes"),
      api<{ binaries: Array<{ os?: string; arch?: string; available: boolean }> }>("/v1/agent/meta").catch(() => null),
    ]);
    setRows(nodes);
    if (agentMeta) setMeta(agentMeta);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<Node>("/admin/nodes", { method: "POST", json: { name, location } });
      setCreated({ node: res, token: res.token || "" });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function rotate(id: string) {
    const res = await api<Node>(`/admin/nodes/${id}/rotate-token`, { method: "POST" });
    setCreated({ node: res, token: res.token || "" });
  }

  async function toggle(n: Node) {
    await api(`/admin/nodes/${n.id}`, { method: "PATCH", json: { enabled: !n.enabled } });
    await load();
  }

  return (
    <>
      <div className="header">
        <div>
          <h1>Probe Nodes</h1>
          <p className="header-copy">Kendi lokasyonunu ekle, one-liner ile VPS’e kur, uzaktan çalıştır.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>1) Node oluştur</h2>
        <form className="row" onSubmit={onCreate}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Istanbul-1" required /></label>
          <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="istanbul / denizli / eu-1" required /></label>
          <label>Public API URL<input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://status-api.example.com" /></label>
          <button type="submit">Create node</button>
        </form>
        {meta && (
          <p className="muted" style={{ marginTop: 12 }}>
            Binaries ready: {meta.binaries.filter((b) => b.available).length}/{meta.binaries.length}
          </p>
        )}
      </div>

      {created && (
        <div className="panel install-hero">
          <h2>2) Uzaktan kurulum — {created.node.name} ({created.node.location})</h2>
          <p className="muted">Token bir kez gösterilir. VPS’te (root) çalıştır:</p>
          <label>Linux one-liner
            <textarea className="mono" readOnly rows={3} value={installCmd} onFocus={(e) => e.target.select()} />
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(installCmd)}>Copy install</button>
            <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(created.token)}>Copy token</button>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="muted">Docker / manual</summary>
            <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{dockerCmd}</pre>
            <pre className="mono">STATUS_API_URL={apiUrl} NODE_TOKEN={created.token} ./status-agent</pre>
          </details>
        </div>
      )}

      <div className="panel">
        <h2>Nodes</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Location</th><th>Host / Ver</th><th>Heartbeat</th><th>Checks</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td>{n.name}</td>
                <td>{n.location}</td>
                <td className="muted">{n.hostname || "—"} {n.version ? `· v${n.version}` : ""}</td>
                <td>{n.lastHeartbeat ? new Date(n.lastHeartbeat).toLocaleString() : "never"}</td>
                <td>{n._count?.checks ?? 0}</td>
                <td>
                  <span className={`badge ${n.online ? "ok" : "err"}`}>{n.online ? "online" : "offline"}</span>{" "}
                  {!n.enabled && <span className="badge warn">disabled</span>}
                </td>
                <td className="row">
                  <button className="secondary" type="button" onClick={() => rotate(n.id)}>Rotate + install</button>
                  <button className="secondary" type="button" onClick={() => toggle(n)}>{n.enabled ? "Disable" : "Enable"}</button>
                  <button className="danger" type="button" onClick={async () => {
                    if (!confirm("Delete node?")) return;
                    await api(`/admin/nodes/${n.id}`, { method: "DELETE" });
                    await load();
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
