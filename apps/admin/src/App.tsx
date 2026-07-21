import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { ServicesPage } from "./pages/Services";
import { ImapPage } from "./pages/Imap";
import { NodesPage } from "./pages/Nodes";
import { MonitorsPage } from "./pages/Monitors";
import { MonitorDetailPage } from "./pages/MonitorDetail";
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
      setError(err instanceof Error ? err.message : "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box grid" onSubmit={onSubmit}>
        <div className="login-kicker">
          <span className="brand-dot" /> Status
        </div>
        <h1>Olfe & İncinet</h1>
        <p className="muted" style={{ marginTop: -4 }}>
          Monitör, node ve bakım yönetimi
        </p>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="username" />
        </label>
        <label>
          Şifre
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="current-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={loading}>{loading ? "Giriş…" : "Giriş yap"}</button>
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
          title: "Ana",
          items: [
            ["/", "▣", "Dashboard"],
            ["/monitors", "◎", "Monitörler"],
          ] as const,
        },
        {
          title: "Altyapı",
          items: [
            ["/nodes", "⬡", "Nodes"],
            ["/services", "▤", "Servisler"],
            ["/tenants", "◈", "Tenantlar"],
          ] as const,
        },
        {
          title: "Operasyon",
          items: [
            ["/imap", "✉", "IMAP / TT"],
            ["/maintenances", "⚒", "Bakımlar"],
            ["/incidents", "⚠", "Olaylar"],
          ] as const,
        },
      ] as const,
    []
  );

  function navActive(to: string) {
    if (to === "/") return loc.pathname === "/";
    return loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-dot" />
            Status
          </div>
          <div className="brand-sub">Olfe · İncinet ISS</div>
        </div>

        <nav className="nav">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="nav-group">{g.title}</div>
              {g.items.map(([to, ico, label]) => (
                <Link key={to} to={to} className={navActive(to) ? "active" : ""}>
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
            Admin panel
          </div>
          <button
            className="secondary"
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", color: "#e5e7eb", borderColor: "rgba(255,255,255,0.1)" }}
            onClick={() => {
              setToken(null);
              nav("/login");
            }}
          >
            Çıkış
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

function RedirectLegacyCheck() {
  const { id } = useParams();
  return <Navigate to={id ? `/monitors/${id}` : "/monitors"} replace />;
}

function NotFound() {
  return (
    <div className="not-found">
      <h1>Sayfa yok</h1>
      <p className="muted">Bu adres tanımlı değil.</p>
      <p style={{ marginTop: 16 }}><Link to="/">Dashboard’a dön</Link> · <Link to="/monitors">Monitörler</Link></p>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Private><Dashboard /></Private>} />
      <Route path="/monitors" element={<Private><MonitorsPage /></Private>} />
      <Route path="/monitors/:id" element={<Private><MonitorDetailPage /></Private>} />
      <Route path="/checks" element={<Navigate to="/monitors" replace />} />
      <Route path="/checks/:id" element={<RedirectLegacyCheck />} />
      <Route path="/tenants" element={<Private><TenantsPage /></Private>} />
      <Route path="/services" element={<Private><ServicesPage /></Private>} />
      <Route path="/imap" element={<Private><ImapPage /></Private>} />
      <Route path="/nodes" element={<Private><NodesPage /></Private>} />
      <Route path="/maintenances" element={<Private><MaintenancesPage /></Private>} />
      <Route path="/incidents" element={<Private><IncidentsPage /></Private>} />
      <Route path="*" element={<Private><NotFound /></Private>} />
    </Routes>
  );
}
