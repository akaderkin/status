import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiDelete } from "../api";

type Detail = {
  id: string;
  name: string;
  type: string;
  target: string;
  operator: string | null;
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
  const h = 170;
  const pad = 16;
  if (data.length < 2) {
    return <div className="empty">Grafik için henüz yeterli ölçüm yok</div>;
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
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-axis" x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />
      </svg>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="mono muted">0 ms</span>
        <span className="mono muted">peak {maxY} ms</span>
      </div>
    </div>
  );
}

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
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
        if (alive) {
          setDetail(null);
          setError(e instanceof Error ? e.message : "Yüklenemedi");
        }
      }
    }
    load();
    const t = setInterval(load, 12000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  const sslLabel = useMemo(() => {
    if (!detail?.sslExpiresAt) return null;
    const days = Math.round((new Date(detail.sslExpiresAt).getTime() - Date.now()) / 86400000);
    return `${days} gün · ${new Date(detail.sslExpiresAt).toLocaleDateString("tr-TR")}`;
  }, [detail]);

  if (!detail && !error) return <div className="empty">Monitör yükleniyor…</div>;

  return (
    <>
      <div className="header">
        <div>
          <div className="sub"><Link to="/monitors">← Monitörler</Link></div>
          <h1>{detail?.name || "Monitör"}</h1>
          {detail && (
            <div className="sub">{detail.tenant.name} · {detail.service.name}</div>
          )}
        </div>
        <div className="row">
          {detail && <span className={`badge ${detail.lastStatus || "warn"}`}>{detail.lastStatus || "bekliyor"}</span>}
          {detail && (
            <button
              className="danger"
              type="button"
              onClick={async () => {
                try {
                  await apiDelete(`/admin/checks/${detail.id}`, detail.name);
                  nav("/monitors");
                } catch (err) {
                  if (err instanceof Error && err.message === "CANCELLED") return;
                  setError(err instanceof Error ? err.message : "Silinemedi");
                }
              }}
            >
              Sil
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error">
          {error}
          {error.includes("bulunamadı") || error.includes("404") ? (
            <div style={{ marginTop: 8 }}>
              <Link to="/monitors">Monitör listesine dön</Link>
            </div>
          ) : null}
        </div>
      )}

      {detail && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="label">Latency</div>
              <div className="value">{detail.lastLatencyMs ?? "—"}<span style={{ fontSize: 13 }}> ms</span></div>
            </div>
            <div className="stat">
              <div className="label">Uptime 24s</div>
              <div className="value">{detail.uptimePct24h ?? "—"}{detail.uptimePct24h != null ? "%" : ""}</div>
            </div>
            <div className="stat">
              <div className="label">Aralık</div>
              <div className="value" style={{ fontSize: 20 }}>{Math.round(detail.intervalMs / 1000)} sn</div>
            </div>
            <div className="stat">
              <div className="label">SSL</div>
              <div className="value" style={{ fontSize: 15 }}>{sslLabel || "—"}</div>
            </div>
          </div>

          <div className="panel">
            <h2>Heartbeat & latency</h2>
            <LatencyChart points={series?.series || []} />
            <div className="heartbeat" style={{ height: 40 }}>
              {detail.sparkline.slice(-56).map((h, i) => (
                <span
                  key={i}
                  className={h.status}
                  style={{ height: h.latencyMs ? `${Math.min(40, 8 + h.latencyMs / 25)}px` : "14px" }}
                  title={`${h.status} ${h.latencyMs ?? "—"}ms`}
                />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Hedef</h2>
            <div className="mono" style={{ fontSize: 14 }}>{detail.target}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              <span className="type-pill">{detail.type}</span>
              {detail.operator && <>{" · "}<span className="type-pill">{detail.operator}</span></>}
              {" · "}timeout {detail.timeoutMs}ms
              {" · "}{detail.enabled ? "aktif" : "duraklatıldı"}
              {detail.lastCheckedAt && ` · son kontrol ${new Date(detail.lastCheckedAt).toLocaleString("tr-TR")}`}
            </div>
            {detail.lastMessage && <div className="mono muted" style={{ marginTop: 10 }}>{detail.lastMessage}</div>}
          </div>

          <div className="panel">
            <h2>Probe node’lar</h2>
            <div className="row">
              {detail.nodes.map((n) => (
                <span key={n.node.id} className="badge ok">{n.node.name} · {n.node.location}</span>
              ))}
              {!detail.nodes.length && <span className="muted">Atanmış node yok</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Son sonuçlar</h2>
            <table>
              <thead>
                <tr><th>Zaman</th><th>Node</th><th>Durum</th><th>Latency</th><th>Mesaj</th></tr>
              </thead>
              <tbody>
                {detail.recentResults.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.checkedAt).toLocaleString("tr-TR")}</td>
                    <td>{r.node.location}</td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td>{r.latencyMs ?? "—"} ms</td>
                    <td className="muted">{r.message}</td>
                  </tr>
                ))}
                {!detail.recentResults.length && (
                  <tr><td colSpan={5} className="empty">Henüz sonuç yok — agent çalışıyor mu?</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** @deprecated */
export const CheckDetailPage = MonitorDetailPage;
