import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type DashboardData = {
  counts: {
    tenants: number;
    services: number;
    openIncidents: number;
    pendingMaintenances: number;
    nodesOnline: number;
    nodesTotal: number;
  };
  kuma: Array<{ id: string; name: string; lastPolledAt: string | null; lastError: string | null; enabled: boolean; tenant: { slug: string } }>;
  imap: Array<{ id: string; name: string; lastPolledAt: string | null; lastError: string | null; enabled: boolean }>;
  nodes: Array<{ id: string; name: string; location: string; online: boolean; lastHeartbeat: string | null }>;
  recentEmails: Array<{ id: string; title: string; status: string; emailSubject: string | null; createdAt: string }>;
};

function ago(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return new Date(iso).toLocaleString("tr-TR");
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  async function load() {
    try {
      setData(await api<DashboardData>("/admin/dashboard"));
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Kontrol paneli yükleniyor…</div>;

  const c = data.counts;
  const health =
    c.openIncidents > 0 ? "Incident açık" : c.pendingMaintenances > 0 ? "Onay bekleyen bakım var" : "Sistem sakin";

  return (
    <>
      <div className="header">
        <div>
          <h1>Operasyon özeti</h1>
          <p className="header-copy">{health}. Olfe & İncinet kaynakları tek ekranda.</p>
        </div>
        <div className="row">
          <span className="muted">{updatedAt ? `güncellendi ${updatedAt.toLocaleTimeString("tr-TR")}` : ""}</span>
          <button className="secondary" type="button" onClick={load}>Yenile</button>
          <Link to="/nodes"><button type="button">+ Node kur</button></Link>
        </div>
      </div>

      <div className="cards">
        <div className="card accent-teal">
          <div className="label">Tenants</div>
          <div className="value">{c.tenants}</div>
        </div>
        <div className="card">
          <div className="label">Services</div>
          <div className="value">{c.services}</div>
        </div>
        <div className={`card ${c.openIncidents ? "accent-danger" : "accent-ok"}`}>
          <div className="label">Open incidents</div>
          <div className="value">{c.openIncidents}</div>
        </div>
        <div className={`card ${c.pendingMaintenances ? "accent-warn" : ""}`}>
          <div className="label">Pending TT</div>
          <div className="value">{c.pendingMaintenances}</div>
        </div>
        <div className={`card ${c.nodesOnline === c.nodesTotal && c.nodesTotal > 0 ? "accent-ok" : "accent-warn"}`}>
          <div className="label">Nodes online</div>
          <div className="value">{c.nodesOnline}/{c.nodesTotal}</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Probe nodes</h2>
            <Link className="muted" to="/nodes">yönet →</Link>
          </div>
          <table>
            <thead>
              <tr><th>Name</th><th>Location</th><th>Heartbeat</th><th>State</th></tr>
            </thead>
            <tbody>
              {data.nodes.map((n) => (
                <tr key={n.id}>
                  <td><strong>{n.name}</strong></td>
                  <td className="mono">{n.location}</td>
                  <td>{ago(n.lastHeartbeat)}</td>
                  <td><span className={`badge ${n.online ? "ok" : "err"}`}>{n.online ? "online" : "offline"}</span></td>
                </tr>
              ))}
              {!data.nodes.length && (
                <tr><td colSpan={4} className="empty">Henüz node yok. Probe Nodes’tan oluşturup VPS’e kur.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>TT / IMAP mailleri</h2>
            <Link className="muted" to="/maintenances">onayla →</Link>
          </div>
          <table>
            <thead><tr><th>Subject</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.recentEmails.map((m) => (
                <tr key={m.id}>
                  <td>{m.emailSubject || m.title}</td>
                  <td><span className={`badge ${m.status === "pending" ? "warn" : "ok"}`}>{m.status}</span></td>
                  <td>{ago(m.createdAt)}</td>
                </tr>
              ))}
              {!data.recentEmails.length && (
                <tr><td colSpan={3} className="empty">IMAP’ten bakım maili gelmedi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Uptime Kuma</h2>
            <Link className="muted" to="/kuma">ayarlar →</Link>
          </div>
          <table>
            <thead><tr><th>Name</th><th>Tenant</th><th>Last poll</th><th>Health</th></tr></thead>
            <tbody>
              {data.kuma.map((k) => (
                <tr key={k.id}>
                  <td><strong>{k.name}</strong></td>
                  <td className="mono">{k.tenant.slug}</td>
                  <td>{ago(k.lastPolledAt)}</td>
                  <td>
                    {k.lastError
                      ? <span className="badge err">error</span>
                      : <span className="badge ok">ok</span>}
                  </td>
                </tr>
              ))}
              {!data.kuma.length && <tr><td colSpan={4} className="empty">Kuma instance eklenmemiş.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>IMAP hesapları</h2>
            <Link className="muted" to="/imap">ayarlar →</Link>
          </div>
          <table>
            <thead><tr><th>Name</th><th>Last poll</th><th>Health</th></tr></thead>
            <tbody>
              {data.imap.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                    {!i.enabled && <> <span className="badge warn">off</span></>}
                  </td>
                  <td>{ago(i.lastPolledAt)}</td>
                  <td>
                    {i.lastError
                      ? <span className="badge err">error</span>
                      : <span className="badge ok">ok</span>}
                  </td>
                </tr>
              ))}
              {!data.imap.length && <tr><td colSpan={3} className="empty">IMAP hesabı yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
