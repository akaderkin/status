import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiDelete } from "../api";

type Tenant = { id: string; name: string };
type Service = { id: string; name: string; tenantId: string };
type Node = { id: string; name: string; location: string };
type Check = {
  id: string;
  name: string;
  type: string;
  target: string;
  intervalMs: number;
  timeoutMs: number;
  expectedStatus: number | null;
  enabled: boolean;
  tenantId: string;
  serviceId: string;
  config: Record<string, unknown> | null;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  sslExpiresAt: string | null;
  service: { id: string; name: string };
  nodes: Array<{ node: { id: string; name: string; location: string } }>;
};

const emptyForm = {
  tenantId: "",
  serviceId: "",
  name: "",
  type: "http",
  target: "",
  intervalMs: 60000,
  timeoutMs: 10000,
  expectedStatus: "",
  nodeIds: [] as string[],
  enabled: true,
  method: "GET",
  keyword: "",
  keywordInvert: false,
  headersJson: "",
  body: "",
  ignoreTls: false,
  maxRedirects: "5",
  retries: "0",
};

export function ChecksPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [rows, setRows] = useState<Check[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function load() {
    const [t, s, n, c] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
      api<Node[]>("/admin/nodes"),
      api<Check[]>("/admin/checks"),
    ]);
    setTenants(t);
    setServices(s);
    setNodes(n);
    setRows(c);
    setForm((f) => {
      const tenantId = f.tenantId || t[0]?.id || "";
      const svc = s.find((x) => x.tenantId === tenantId);
      return {
        ...f,
        tenantId,
        serviceId: f.serviceId || svc?.id || "",
      };
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function toggleNode(id: string) {
    setForm((f) => ({
      ...f,
      nodeIds: f.nodeIds.includes(id) ? f.nodeIds.filter((x) => x !== id) : [...f.nodeIds, id],
    }));
  }

  function buildConfig() {
    if (form.type !== "http" && form.retries === "0") return undefined;
    const config: Record<string, unknown> = {};
    if (form.type === "http") {
      if (form.method && form.method !== "GET") config.method = form.method;
      if (form.keyword) config.keyword = form.keyword;
      if (form.keywordInvert) config.keywordInvert = true;
      if (form.body) config.body = form.body;
      if (form.ignoreTls) config.ignoreTls = true;
      if (form.maxRedirects) config.maxRedirects = Number(form.maxRedirects);
      if (form.headersJson.trim()) {
        try {
          config.headers = JSON.parse(form.headersJson);
        } catch {
          throw new Error("Headers must be valid JSON object");
        }
      }
    }
    if (Number(form.retries) > 0) config.retries = Number(form.retries);
    return Object.keys(config).length ? config : undefined;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const config = buildConfig();
      const payload = {
        tenantId: form.tenantId,
        serviceId: form.serviceId,
        name: form.name,
        type: form.type,
        target: form.target,
        intervalMs: form.intervalMs,
        timeoutMs: form.timeoutMs,
        expectedStatus: form.expectedStatus ? Number(form.expectedStatus) : undefined,
        nodeIds: form.nodeIds,
        enabled: form.enabled,
        config,
      };
      if (editId) {
        const { tenantId: _t, ...rest } = payload;
        await api(`/admin/checks/${editId}`, { method: "PATCH", json: rest });
      } else {
        await api("/admin/checks", { method: "POST", json: payload });
      }
      setEditId(null);
      setForm((f) => ({
        ...emptyForm,
        tenantId: f.tenantId,
        serviceId: f.serviceId,
      }));
      setShowAdvanced(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  function startEdit(c: Check) {
    const cfg = (c.config || {}) as Record<string, unknown>;
    setEditId(c.id);
    setForm({
      tenantId: c.tenantId,
      serviceId: c.serviceId,
      name: c.name,
      type: c.type,
      target: c.target,
      intervalMs: c.intervalMs,
      timeoutMs: c.timeoutMs,
      expectedStatus: c.expectedStatus?.toString() || "",
      nodeIds: c.nodes.map((n) => n.node.id),
      enabled: c.enabled,
      method: String(cfg.method || "GET"),
      keyword: String(cfg.keyword || ""),
      keywordInvert: Boolean(cfg.keywordInvert),
      headersJson: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
      body: String(cfg.body || ""),
      ignoreTls: Boolean(cfg.ignoreTls),
      maxRedirects: String(cfg.maxRedirects ?? 5),
      retries: String(cfg.retries ?? 0),
    });
    setShowAdvanced(c.type === "http");
  }

  return (
    <>
      <div className="header">
        <div>
          <h1>Monitors</h1>
          <div className="sub">HTTP, TCP ve ICMP kontrolleri</div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>{editId ? "Monitor düzenle" : "Yeni monitor"}</h2>
        <form className="grid" onSubmit={onSubmit}>
          <div className="row">
            {!editId && (
              <label>
                Tenant
                <select
                  value={form.tenantId}
                  onChange={(e) => {
                    const tenantId = e.target.value;
                    const svc = services.find((x) => x.tenantId === tenantId);
                    setForm({ ...form, tenantId, serviceId: svc?.id || "" });
                  }}
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Service
              <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} required>
                <option value="">Select…</option>
                {services.filter((s) => s.tenantId === form.tenantId || editId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="http">HTTP(S)</option>
                <option value="tcp">TCP</option>
                <option value="icmp">ICMP Ping</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Target
              <input
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                placeholder={form.type === "tcp" ? "host:443" : form.type === "icmp" ? "1.1.1.1" : "https://…"}
                required
              />
            </label>
          </div>
          <div className="row">
            <label>
              Interval ms
              <input type="number" value={form.intervalMs} onChange={(e) => setForm({ ...form, intervalMs: Number(e.target.value) })} />
            </label>
            <label>
              Timeout ms
              <input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} />
            </label>
            {form.type === "http" && (
              <label>
                Expected HTTP
                <input value={form.expectedStatus} onChange={(e) => setForm({ ...form, expectedStatus: e.target.value })} placeholder="200" />
              </label>
            )}
            <label>
              Retries
              <input type="number" min={0} max={5} value={form.retries} onChange={(e) => setForm({ ...form, retries: e.target.value })} />
            </label>
          </div>

          {form.type === "http" && (
            <>
              <button type="button" className="secondary" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "Hide HTTP options" : "HTTP options"}
              </button>
              {showAdvanced && (
                <div className="grid" style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 4 }}>
                  <div className="row">
                    <label>
                      Method
                      <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                        {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Max redirects
                      <input type="number" value={form.maxRedirects} onChange={(e) => setForm({ ...form, maxRedirects: e.target.value })} />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                      <input type="checkbox" checked={form.ignoreTls} onChange={(e) => setForm({ ...form, ignoreTls: e.target.checked })} />
                      Ignore TLS
                    </label>
                  </div>
                  <label>
                    Keyword
                    <input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="must contain…" />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                    <input type="checkbox" checked={form.keywordInvert} onChange={(e) => setForm({ ...form, keywordInvert: e.target.checked })} />
                    Invert keyword (fail if present)
                  </label>
                  <label>
                    Headers (JSON)
                    <textarea rows={3} value={form.headersJson} onChange={(e) => setForm({ ...form, headersJson: e.target.value })} placeholder='{"Authorization":"Bearer …"}' />
                  </label>
                  <label>
                    Body
                    <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                  </label>
                </div>
              )}
            </>
          )}

          <div>
            <div className="muted" style={{ marginBottom: 6, fontFamily: "var(--mono)", fontSize: 11 }}>
              Node’larda çalıştır
            </div>
            <div className="row">
              {nodes.map((n) => (
                <label key={n.id} style={{ display: "flex", gap: 6, alignItems: "center", textTransform: "none", flex: "0 0 auto" }}>
                  <input type="checkbox" checked={form.nodeIds.includes(n.id)} onChange={() => toggleNode(n.id)} />
                  {n.name} ({n.location})
                </label>
              ))}
              {!nodes.length && <span className="muted">Create a probe node first</span>}
            </div>
          </div>

          <div className="row">
            <button type="submit">{editId ? "Kaydet" : "Ekle"}</button>
            {editId && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditId(null);
                  setForm((f) => ({ ...emptyForm, tenantId: f.tenantId }));
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Liste</h2>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Type</th>
              <th>Target</th>
              <th>Latency</th>
              <th>Nodes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><span className={`badge ${c.lastStatus || "warn"}`}>{c.lastStatus || "—"}</span></td>
                <td>
                  <Link to={`/checks/${c.id}`}>{c.name}</Link>
                  <div className="muted">{c.service.name}</div>
                </td>
                <td className="mono">{c.type}</td>
                <td className="mono">{c.target}</td>
                <td>{c.lastLatencyMs != null ? `${c.lastLatencyMs}ms` : "—"}</td>
                <td>{c.nodes.map((n) => n.node.location).join(", ") || "—"}</td>
                <td className="row">
                  <Link className="mono" to={`/checks/${c.id}`} style={{ alignSelf: "center" }}>Detay</Link>
                  <button className="secondary" type="button" onClick={() => startEdit(c)}>Edit</button>
                  <button
                    className="danger"
                    type="button"
                    onClick={async () => {
                      try {
                        await apiDelete(`/admin/checks/${c.id}`, c.name);
                        await load();
                      } catch (err) {
                        if (err instanceof Error && err.message === "CANCELLED") return;
                        setError(err instanceof Error ? err.message : "Silinemedi");
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty">Monitor yok</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
