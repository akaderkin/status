import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Monitor = {
  id: string;
  name: string;
  type: string;
  target: string;
  enabled: boolean;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  sslExpiresAt: string | null;
  uptimePct: number | null;
  service: { id: string; name: string };
  tenant: { slug: string; name: string };
  nodes: Array<{ id: string; name: string; location: string; online: boolean }>;
  heartbeats: Array<{ status: string; latencyMs: number | null; checkedAt: string }>;
};

type Dash = {
  counts: {
    tenants: number;
    services: number;
    openIncidents: number;
    pendingMaintenances: number;
    checksTotal: number;
    checksDown: number;
    checksDegraded: number;
    nodesOnline: number;
    nodesTotal: number;
  };
  monitors: Monitor[];
  nodes: Array<{ id: string; name: string; location: string; online: boolean; enabled: boolean }>;
  recentFailures: Array<{
    id: string;
    status: string;
    message: string | null;
    checkedAt: string;
    check: { id: string; name: string };
    node: { name: string; location: string };
  }>;
  imap: Array<{ id: string; name: string; lastPolledAt: string | null; lastError: string | null; enabled: boolean }>;
  recentEmails: Array<{ id: string; title: string; status: string; emailSubject: string | null; createdAt: string }>;
};

export function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const d = await api<Dash>("/admin/dashboard");
        if (alive) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed");
      }
    }
    load();
    const t = setInterval(() => {
      setTick((x) => x + 1);
      load();
    }, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data && !error) {
    return <div className="empty">SYNCING TELEMETRY…</div>;
  }

  return (
    <>
      <div className="header">
        <div>
          <h1>Command Deck</h1>
          <div className="sub">Live monitor grid · refresh #{tick}</div>
        </div>
        <span className="live-pill"><i /> LIVE</span>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Monitors</div><div className="value">{data.counts.checksTotal}</div></div>
            <div className="stat"><div className="label">Down</div><div className="value" style={{ color: data.counts.checksDown ? "var(--red)" : undefined }}>{data.counts.checksDown}</div></div>
            <div className="stat"><div className="label">Degraded</div><div className="value" style={{ color: data.counts.checksDegraded ? "var(--amber)" : undefined }}>{data.counts.checksDegraded}</div></div>
            <div className="stat"><div className="label">Nodes</div><div className="value">{data.counts.nodesOnline}/{data.counts.nodesTotal}</div></div>
            <div className="stat"><div className="label">Incidents</div><div className="value">{data.counts.openIncidents}</div></div>
            <div className="stat"><div className="label">Pending TT</div><div className="value">{data.counts.pendingMaintenances}</div></div>
          </div>

          <div className="panel">
            <h2>Monitors</h2>
            {!data.monitors.length && <div className="empty">No monitors yet — create one under Monitors.</div>}
            <div className="monitor-grid">
              {data.monitors.map((m) => (
                <Link
                  key={m.id}
                  to={`/checks/${m.id}`}
                  className={`monitor-card ${m.lastStatus || ""}`}
                >
                  <div className="monitor-top">
                    <div>
                      <div className="monitor-name">{m.name}</div>
                      <div className="muted mono" style={{ marginTop: 4 }}>{m.tenant.slug} · {m.service.name}</div>
                    </div>
                    <span className={`badge ${m.lastStatus || "warn"}`}>{m.lastStatus || "unknown"}</span>
                  </div>
                  <div className="monitor-meta">
                    <span>{m.type.toUpperCase()}</span>
                    <span>{m.lastLatencyMs != null ? `${m.lastLatencyMs}ms` : "—"}</span>
                    <span>{m.uptimePct != null ? `${m.uptimePct}% 24h` : "—"}</span>
                    <span className="node-dots" title="Probe nodes">
                      {m.nodes.map((n) => (
                        <span key={n.id} className={`node-dot ${n.online ? "on" : "off"}`} title={`${n.location}`} />
                      ))}
                    </span>
                  </div>
                  <div className="heartbeat" title="Recent heartbeats">
                    {(m.heartbeats.length ? m.heartbeats : Array.from({ length: 24 }).map(() => ({ status: "" }))).slice(-32).map((h, i) => (
                      <span
                        key={i}
                        className={h.status}
                        style={{ height: h.latencyMs ? `${Math.min(28, 8 + (h.latencyMs / 40))}px` : "10px" }}
                      />
                    ))}
                  </div>
                  <div className="mono muted" style={{ marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.target}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="row" style={{ alignItems: "stretch" }}>
            <div className="panel" style={{ flex: 1, minWidth: 280 }}>
              <h2>Recent failures</h2>
              <table>
                <thead><tr><th>Time</th><th>Monitor</th><th>Node</th><th>Status</th></tr></thead>
                <tbody>
                  {data.recentFailures.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{new Date(f.checkedAt).toLocaleTimeString()}</td>
                      <td><Link to={`/checks/${f.check.id}`}>{f.check.name}</Link></td>
                      <td>{f.node.location}</td>
                      <td><span className={`badge ${f.status}`}>{f.status}</span></td>
                    </tr>
                  ))}
                  {!data.recentFailures.length && <tr><td colSpan={4} className="empty">Clean — no failures in 24h</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel" style={{ flex: 1, minWidth: 280 }}>
              <h2>Probe nodes</h2>
              <table>
                <thead><tr><th>Name</th><th>Loc</th><th>State</th></tr></thead>
                <tbody>
                  {data.nodes.map((n) => (
                    <tr key={n.id}>
                      <td>{n.name}</td>
                      <td className="mono">{n.location}</td>
                      <td><span className={`badge ${n.online ? "ok" : "err"}`}>{n.online ? "online" : "offline"}</span></td>
                    </tr>
                  ))}
                  {!data.nodes.length && <tr><td colSpan={3} className="empty">No nodes</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
