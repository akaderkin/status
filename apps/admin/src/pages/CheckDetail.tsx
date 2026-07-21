import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

type Detail = {
  id: string;
  name: string;
  type: string;
  target: string;
  intervalMs: number;
  timeoutMs: number;
  enabled: boolean;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  lastMessage: string | null;
  sslExpiresAt: string | null;
  uptimePct24h: number | null;
  config: Record<string, unknown> | null;
  service: { id: string; name: string; status: string };
  tenant: { slug: string; name: string };
  nodes: Array<{ node: { id: string; name: string; location: string; lastHeartbeat: string | null } }>;
  recentResults: Array<{
    id: string;
    status: string;
    latencyMs: number | null;
    message: string | null;
    checkedAt: string;
    node: { name: string; location: string };
  }>;
  sparkline: Array<{ t: string; status: string; latencyMs: number | null }>;
};

type Series = {
  series: Array<{ t: string; avgLatencyMs: number | null; uptimePct: number | null; up: number; down: number; total: number }>;
};

function LatencyChart({ points }: { points: Array<{ t: string; avgLatencyMs: number | null }> }) {
  const data = points.filter((p) => p.avgLatencyMs != null) as Array<{ t: string; avgLatencyMs: number }>;
  const w = 640;
  const h = 160;
  const pad = 16;
  if (data.length < 2) {
    return <div className="empty">Not enough samples for chart</div>;
  }
  const maxY = Math.max(...data.map((d) => d.avgLatencyMs), 1);
  const coords = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (d.avgLatencyMs / maxY) * (h - pad * 2);
    return `${x},${y}`;
  });
  const line = coords.join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-axis" x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />
      </svg>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="mono muted">0</span>
        <span className="mono muted">peak {maxY}ms</span>
      </div>
    </div>
  );
}

export function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function load() {
      try {
        const [d, s] = await Promise.all([
          api<Detail>(`/admin/checks/${id}`),
          api<Series>(`/admin/checks/${id}/series?bucketMs=300000`),
        ]);
        if (alive) {
          setDetail(d);
          setSeries(s);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed");
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  const sslLabel = useMemo(() => {
    if (!detail?.sslExpiresAt) return null;
    const days = Math.round((new Date(detail.sslExpiresAt).getTime() - Date.now()) / 86400000);
    return `${days}d · ${new Date(detail.sslExpiresAt).toLocaleDateString()}`;
  }, [detail]);

  if (!detail && !error) return <div className="empty">LOADING MONITOR…</div>;

  return (
    <>
      <div className="header">
        <div>
          <div className="sub"><Link to="/checks">← Monitors</Link></div>
          <h1>{detail?.name || "Monitor"}</h1>
          <div className="sub">{detail?.tenant.slug} · {detail?.service.name}</div>
        </div>
        {detail && <span className={`badge ${detail.lastStatus || "warn"}`}>{detail.lastStatus || "unknown"}</span>}
      </div>
      {error && <div className="error">{error}</div>}

      {detail && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Latency</div><div className="value">{detail.lastLatencyMs ?? "—"}<span style={{ fontSize: 12 }}>ms</span></div></div>
            <div className="stat"><div className="label">Uptime 24h</div><div className="value">{detail.uptimePct24h ?? "—"}{detail.uptimePct24h != null ? "%" : ""}</div></div>
            <div className="stat"><div className="label">Interval</div><div className="value" style={{ fontSize: 18 }}>{detail.intervalMs}ms</div></div>
            <div className="stat"><div className="label">SSL</div><div className="value" style={{ fontSize: 14 }}>{sslLabel || "—"}</div></div>
          </div>

          <div className="panel">
            <h2>Latency · 6h</h2>
            <LatencyChart points={series?.series || []} />
            <div className="heartbeat" style={{ height: 36 }}>
              {detail.sparkline.slice(-48).map((h, i) => (
                <span
                  key={i}
                  className={h.status}
                  style={{ height: h.latencyMs ? `${Math.min(36, 8 + h.latencyMs / 30)}px` : "12px" }}
                  title={`${h.status} ${h.latencyMs ?? "—"}ms`}
                />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Target</h2>
            <div className="mono">{detail.target}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              {detail.type.toUpperCase()} · timeout {detail.timeoutMs}ms · {detail.enabled ? "enabled" : "paused"}
            </div>
            {detail.lastMessage && <div className="mono muted" style={{ marginTop: 8 }}>{detail.lastMessage}</div>}
            {detail.config && Object.keys(detail.config).length > 0 && (
              <pre className="mono" style={{ marginTop: 12, fontSize: 11, opacity: 0.8 }}>{JSON.stringify(detail.config, null, 2)}</pre>
            )}
          </div>

          <div className="panel">
            <h2>Nodes</h2>
            <div className="row">
              {detail.nodes.map((n) => (
                <span key={n.node.id} className="badge ok">{n.node.name} · {n.node.location}</span>
              ))}
              {!detail.nodes.length && <span className="muted">No nodes assigned</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Recent results</h2>
            <table>
              <thead><tr><th>Time</th><th>Node</th><th>Status</th><th>Latency</th><th>Message</th></tr></thead>
              <tbody>
                {detail.recentResults.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.checkedAt).toLocaleString()}</td>
                    <td>{r.node.location}</td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td>{r.latencyMs ?? "—"}ms</td>
                    <td className="muted">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
