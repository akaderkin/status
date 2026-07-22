import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Monitor = {
  id: string;
  name: string;
  type: string;
  target: string;
  operator: string | null;
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
    check: { id: string; name: string; operator: string | null };
    node: { name: string; location: string };
  }>;
};

export function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");

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
        if (alive) setError(e instanceof Error ? e.message : "Yüklenemedi");
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data && !error) {
    return <div className="empty">Yükleniyor…</div>;
  }

  return (
    <>
      <div className="header">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Canlı monitör özeti</div>
        </div>
        <div className="row">
          <span className="live-pill"><i /> Canlı</span>
          <Link to="/monitors"><button type="button">Monitörler</button></Link>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Monitör</div><div className="value">{data.counts.checksTotal}</div></div>
            <div className="stat"><div className="label">Down</div><div className="value" style={{ color: data.counts.checksDown ? "var(--err)" : undefined }}>{data.counts.checksDown}</div></div>
            <div className="stat"><div className="label">Degraded</div><div className="value" style={{ color: data.counts.checksDegraded ? "var(--warn)" : undefined }}>{data.counts.checksDegraded}</div></div>
            <div className="stat"><div className="label">Nodes</div><div className="value">{data.counts.nodesOnline}/{data.counts.nodesTotal}</div></div>
            <div className="stat"><div className="label">Olaylar</div><div className="value">{data.counts.openIncidents}</div></div>
            <div className="stat"><div className="label">Bekleyen TT</div><div className="value">{data.counts.pendingMaintenances}</div></div>
          </div>

          <div className="panel">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Monitörler</h2>
              <Link to="/monitors" className="muted">tümü →</Link>
            </div>
            {!data.monitors.length && (
              <div className="empty">
                Henüz monitör yok. <Link to="/monitors">İlk monitörü ekle</Link>
              </div>
            )}
            <div className="monitor-grid">
              {data.monitors.map((m) => (
                <Link
                  key={m.id}
                  to={`/monitors/${m.id}`}
                  className={`monitor-card ${m.lastStatus || ""}`}
                >
                  <div className="monitor-top">
                    <div>
                      <div className="monitor-name">
                        {m.operator ? `${m.operator} / ${m.name}` : m.name}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{m.tenant.slug} · {m.service.name}</div>
                    </div>
                    <span className={`badge ${m.lastStatus || "warn"}`}>{m.lastStatus || "bekliyor"}</span>
                  </div>
                  <div className="monitor-meta">
                    <span className="type-pill">{m.type}</span>
                    <span>{m.lastLatencyMs != null ? `${m.lastLatencyMs} ms` : "—"}</span>
                    <span>{m.uptimePct != null ? `${m.uptimePct}% 24s` : "—"}</span>
                    <span className="node-dots" title="Probe nodes">
                      {m.nodes.map((n) => (
                        <span key={n.id} className={`node-dot ${n.online ? "on" : "off"}`} title={n.location} />
                      ))}
                    </span>
                  </div>
                  <div className="heartbeat" title="Son heartbeat’ler">
                    {(m.heartbeats.length
                      ? m.heartbeats
                      : Array.from({ length: 28 }).map(() => ({ status: "", latencyMs: null as number | null, checkedAt: "" }))
                    ).slice(-36).map((h, i) => (
                      <span
                        key={i}
                        className={h.status}
                        style={{ height: h.latencyMs ? `${Math.min(34, 8 + h.latencyMs / 35)}px` : "12px" }}
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
              <h2>Son hatalar</h2>
              <table>
                <thead><tr><th>Zaman</th><th>Monitör</th><th>Node</th><th>Durum</th></tr></thead>
                <tbody>
                  {data.recentFailures.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{new Date(f.checkedAt).toLocaleTimeString("tr-TR")}</td>
                      <td>
                        <Link to={`/monitors/${f.check.id}`}>
                          {f.check.operator ? `${f.check.operator} / ${f.check.name}` : f.check.name}
                        </Link>
                      </td>
                      <td>{f.node.location}</td>
                      <td><span className={`badge ${f.status}`}>{f.status}</span></td>
                    </tr>
                  ))}
                  {!data.recentFailures.length && <tr><td colSpan={4} className="empty">Son 24 saatte sorun yok</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel" style={{ flex: 1, minWidth: 280 }}>
              <h2>Probe node’lar</h2>
              <table>
                <thead><tr><th>İsim</th><th>Lokasyon</th><th>Durum</th></tr></thead>
                <tbody>
                  {data.nodes.map((n) => (
                    <tr key={n.id}>
                      <td>{n.name}</td>
                      <td className="mono">{n.location}</td>
                      <td><span className={`badge ${n.online ? "ok" : "err"}`}>{n.online ? "online" : "offline"}</span></td>
                    </tr>
                  ))}
                  {!data.nodes.length && (
                    <tr><td colSpan={3} className="empty"><Link to="/nodes">Node ekle</Link></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
