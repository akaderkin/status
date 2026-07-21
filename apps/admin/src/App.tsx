import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { ServicesPage } from "./pages/Services";
import { ImapPage } from "./pages/Imap";
import { NodesPage } from "./pages/Nodes";
import { ChecksPage } from "./pages/Checks";
import { CheckDetailPage } from "./pages/CheckDetail";
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
          <span className="brand-dot" /> NEXUS OPS
        </div>
        <h1>STATUS GRID</h1>
        <p className="muted" style={{ marginTop: -4 }}>
          Multi-node probes · Olfe & İncinet · live telemetry
        </p>
        <label>
          Access ID
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Auth Key
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={loading}>{loading ? "AUTH…" : "ENTER GRID"}</button>
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
          title: "Command",
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
          items: [["/imap", "✉", "IMAP / TT"]] as const,
        },
        {
          title: "Probes",
          items: [
            ["/nodes", "⬡", "Nodes"],
            ["/checks", "◎", "Monitors"],
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

  function navActive(to: string) {
    if (to === "/") return loc.pathname === "/";
    return loc.pathname === to || loc.pathname.startsWith(to + "/");
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-dot" />
            NEXUS
          </div>
          <div className="brand-sub">OLFE · INCINET // STATUS</div>
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
            SYS.LIVE · GRID ONLINE
          </div>
          <button
            className="secondary"
            style={{ width: "100%" }}
            onClick={() => {
              setToken(null);
              nav("/login");
            }}
          >
            Disconnect
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
      <Route path="/imap" element={<Private><ImapPage /></Private>} />
      <Route path="/nodes" element={<Private><NodesPage /></Private>} />
      <Route path="/checks" element={<Private><ChecksPage /></Private>} />
      <Route path="/checks/:id" element={<Private><CheckDetailPage /></Private>} />
      <Route path="/maintenances" element={<Private><MaintenancesPage /></Private>} />
      <Route path="/incidents" element={<Private><IncidentsPage /></Private>} />
    </Routes>
  );
}
