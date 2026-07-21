import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { ServicesPage } from "./pages/Services";
import { KumaPage } from "./pages/Kuma";
import { ImapPage } from "./pages/Imap";
import { NodesPage } from "./pages/Nodes";
import { ChecksPage } from "./pages/Checks";
import { MaintenancesPage } from "./pages/Maintenances";
import { IncidentsPage } from "./pages/Incidents";
import { TenantsPage } from "./pages/Tenants";

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@olfe.net");
  const [password, setPassword] = useState("changeme123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string }>("/admin/auth/login", {
        method: "POST",
        json: { email, password },
      });
      setToken(res.token);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box grid" onSubmit={onSubmit}>
        <div className="login-kicker">
          <span className="brand-dot" /> Status Desk
        </div>
        <h1>Olfe & İncinet</h1>
        <p className="muted" style={{ marginTop: -4 }}>Altyapı durumu, probe node’lar ve bakım operasyonu.</p>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={loading}>{loading ? "Giriş yapılıyor…" : "Panele gir"}</button>
      </form>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(
    () =>
      [
        {
          title: "Overview",
          items: [["/", "◈", "Dashboard"]] as const,
        },
        {
          title: "Catalog",
          items: [
            ["/tenants", "▣", "Tenants"],
            ["/services", "▤", "Services"],
          ] as const,
        },
        {
          title: "Ingest",
          items: [
            ["/kuma", "◉", "Uptime Kuma"],
            ["/imap", "✉", "IMAP / TT"],
          ] as const,
        },
        {
          title: "Probes",
          items: [
            ["/nodes", "⬡", "Probe Nodes"],
            ["/checks", "◎", "Checks"],
          ] as const,
        },
        {
          title: "Ops",
          items: [
            ["/maintenances", "⚒", "Maintenances"],
            ["/incidents", "⚠", "Incidents"],
          ] as const,
        },
      ] as const,
    []
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-dot" />
            Status Desk
          </div>
          <div className="brand-sub">Olfe · İncinet ISS</div>
        </div>

        <nav className="nav">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="nav-group">{g.title}</div>
              {g.items.map(([to, ico, label]) => (
                <Link key={to} to={to} className={loc.pathname === to ? "active" : ""}>
                  <span className="nav-ico">{ico}</span>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-meta">
            <strong>{now.toLocaleTimeString("tr-TR")}</strong>
            Ops console · live
          </div>
          <button
            className="secondary"
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", color: "#e8eef7", borderColor: "rgba(255,255,255,0.12)" }}
            onClick={() => {
              setToken(null);
              nav("/login");
            }}
          >
            Çıkış yap
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

function Private({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Private><Dashboard /></Private>} />
      <Route path="/tenants" element={<Private><TenantsPage /></Private>} />
      <Route path="/services" element={<Private><ServicesPage /></Private>} />
      <Route path="/kuma" element={<Private><KumaPage /></Private>} />
      <Route path="/imap" element={<Private><ImapPage /></Private>} />
      <Route path="/nodes" element={<Private><NodesPage /></Private>} />
      <Route path="/checks" element={<Private><ChecksPage /></Private>} />
      <Route path="/maintenances" element={<Private><MaintenancesPage /></Private>} />
      <Route path="/incidents" element={<Private><IncidentsPage /></Private>} />
    </Routes>
  );
}
