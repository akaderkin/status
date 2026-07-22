import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiDelete } from "../api";

type Tenant = { id: string; name: string };
type Service = { id: string; name: string; tenantId: string; groupName: string | null };
type Node = { id: string; name: string; location: string };
type Operator = { id: string; name: string };
type Monitor = {
  id: string;
  name: string;
  type: string;
  target: string;
  operator: string | null;
  intervalMs: number;
  timeoutMs: number;
  expectedStatus: number | null;
  enabled: boolean;
  tenantId: string;
  serviceId: string;
  config: Record<string, unknown> | null;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  sslExpiresAt: string | null;
  service: { id: string; name: string };
  tenant?: { slug: string };
  nodes: Array<{ node: { id: string; name: string; location: string } }>;
};

const emptyForm = {
  tenantId: "",
  serviceId: "",
  name: "",
  type: "http",
  target: "",
  operator: "",
  intervalSec: 60,
  timeoutSec: 10,
  expectedStatus: "",
  nodeIds: [] as string[],
  allNodes: true,
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

type StatusFilter = "all" | "up" | "down" | "degraded";

export function MonitorsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [newOperator, setNewOperator] = useState("");
  const [rows, setRows] = useState<Monitor[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const tenantServices = useMemo(
    () => services.filter((s) => s.tenantId === form.tenantId),
    [services, form.tenantId]
  );

  async function load() {
    const [t, s, n, c] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
      api<Node[]>("/admin/nodes"),
      api<Monitor[]>("/admin/checks"),
    ]);
    setTenants(t);
    setServices(s);
    setNodes(n);
    setRows(c);
    setForm((f) => {
      const tenantId = f.tenantId || t[0]?.id || "";
      const forTenant = s.filter((x) => x.tenantId === tenantId);
      return {
        ...f,
        tenantId,
        serviceId: f.serviceId || forTenant[0]?.id || "",
        nodeIds: f.allNodes ? n.map((x) => x.id) : f.nodeIds,
      };
    });
    try {
      const ops = await api<Operator[]>("/admin/operators");
      setOperators(ops);
    } catch {
      setOperators([]);
    }
  }

  async function addOperator() {
    const name = newOperator.trim();
    if (!name) return;
    try {
      const row = await api<Operator>("/admin/operators", { method: "POST", json: { name } });
      setOperators((prev) => {
        if (prev.some((o) => o.id === row.id)) return prev;
        return [...prev, row].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      });
      setForm((f) => ({ ...f, operator: row.name }));
      setNewOperator("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operatör eklenemedi");
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.lastStatus !== statusFilter) return false;
      if (!s) return true;
      return (
        r.name.toLowerCase().includes(s) ||
        r.target.toLowerCase().includes(s) ||
        r.type.toLowerCase().includes(s) ||
        r.service.name.toLowerCase().includes(s) ||
        (r.operator || "").toLowerCase().includes(s)
      );
    });
  }, [rows, q, statusFilter]);

  function setAllNodes(on: boolean) {
    setForm((f) => ({
      ...f,
      allNodes: on,
      nodeIds: on ? nodes.map((n) => n.id) : [],
    }));
  }

  function toggleNode(id: string) {
    setForm((f) => {
      const next = f.nodeIds.includes(id) ? f.nodeIds.filter((x) => x !== id) : [...f.nodeIds, id];
      return {
        ...f,
        nodeIds: next,
        allNodes: nodes.length > 0 && next.length === nodes.length,
      };
    });
  }

  function buildConfig() {
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
          throw new Error("Headers geçerli JSON olmalı");
        }
      }
    }
    if (form.retries !== "" && form.retries != null) {
      config.retries = Math.max(0, Number(form.retries) || 0);
    }
    return Object.keys(config).length ? config : undefined;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!form.serviceId) throw new Error("Hangi servisi izleyeceğini seç");
      if (!form.name.trim()) throw new Error("Monitör adı yaz");
      const intervalMs = Math.max(5, Number(form.intervalSec) || 60) * 1000;
      const timeoutMs = Math.max(1, Number(form.timeoutSec) || 10) * 1000;
      const nodeIds = form.allNodes ? nodes.map((n) => n.id) : form.nodeIds;
      if (!nodeIds.length) throw new Error("En az bir node seç (veya Tüm node’lar)");

      const config = buildConfig();
      const payload = {
        tenantId: form.tenantId,
        serviceId: form.serviceId,
        name: form.name.trim(),
        type: form.type,
        target: form.target.trim(),
        operator: form.operator.trim() || null,
        intervalMs,
        timeoutMs,
        expectedStatus: form.expectedStatus ? Number(form.expectedStatus) : undefined,
        nodeIds,
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
      setShowForm(false);
      setShowAdvanced(false);
      setForm((f) => ({
        ...emptyForm,
        tenantId: f.tenantId,
        serviceId: f.serviceId,
        allNodes: true,
        nodeIds: nodes.map((n) => n.id),
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaydedilemedi");
    }
  }

  function startEdit(c: Monitor) {
    const cfg = (c.config || {}) as Record<string, unknown>;
    const nodeIds = c.nodes.map((n) => n.node.id);
    setEditId(c.id);
    setShowForm(true);
    setForm({
      tenantId: c.tenantId,
      serviceId: c.serviceId,
      name: c.name,
      type: c.type,
      target: c.target,
      operator: c.operator || "",
      intervalSec: Math.max(1, Math.round(c.intervalMs / 1000)),
      timeoutSec: Math.max(1, Math.round(c.timeoutMs / 1000)),
      expectedStatus: c.expectedStatus?.toString() || "",
      nodeIds,
      allNodes: nodes.length > 0 && nodeIds.length === nodes.length,
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
          <h1>Monitörler</h1>
          <div className="sub">HTTP · TCP · ICMP — node’lardan canlı kontrol</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditId(null);
            setShowForm((v) => !v);
            setShowAdvanced(false);
            if (!showForm) {
              const tenantId = tenants[0]?.id || "";
              const svc = services.find((x) => x.tenantId === tenantId);
              setForm({
                ...emptyForm,
                tenantId,
                serviceId: svc?.id || "",
                allNodes: true,
                nodeIds: nodes.map((n) => n.id),
              });
            }
          }}
        >
          {showForm ? "Kapat" : "+ Yeni monitör"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showForm && (
        <div className="panel">
          <h2>{editId ? "Monitörü düzenle" : "Yeni monitör"}</h2>
          <form className="grid" onSubmit={onSubmit}>
            <div className="row">
              {!editId && (
                <label>
                  Firma / tenant
                  <select
                    value={form.tenantId}
                    onChange={(e) => {
                      const tenantId = e.target.value;
                      const first = services.find((x) => x.tenantId === tenantId);
                      setForm({ ...form, tenantId, serviceId: first?.id || "" });
                    }}
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Hangi servisi izliyoruz?
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  required
                >
                  <option value="">Servis seç…</option>
                  {tenantServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.groupName ? `${s.groupName} — ${s.name}` : s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kontrol tipi
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="http">HTTP / HTTPS (web sitesi)</option>
                  <option value="tcp">TCP (port açık mı)</option>
                  <option value="icmp">Ping (ICMP)</option>
                </select>
              </label>
              <label>
                Operatör
                <select value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })}>
                  <option value="">Yok (boş)</option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.name}>{op.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" style={{ alignItems: "end" }}>
              <label>
                Yeni operatör ekle
                <input
                  value={newOperator}
                  onChange={(e) => setNewOperator(e.target.value)}
                  placeholder="örn. Türk Telekom"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOperator();
                    }
                  }}
                />
              </label>
              <button type="button" className="secondary" onClick={addOperator}>
                Operatör kaydet
              </button>
            </div>
            {!tenantServices.length && (
              <div className="muted" style={{ fontSize: 13 }}>
                Bu tenant için servis yok. Önce <Link to="/services">Servisler</Link> sayfasından ekle
                (ör. Çekirdek Ağ, DNS, Müşteri Portalı).
              </div>
            )}
            <div className="row">
              <label>
                Monitör adı
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Gateway ping" />
              </label>
              <label>
                Hedef
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
                Aralık (saniye)
                <input
                  type="number"
                  min={5}
                  value={form.intervalSec}
                  onChange={(e) => setForm({ ...form, intervalSec: Number(e.target.value) })}
                />
              </label>
              <label>
                Timeout (saniye)
                <input
                  type="number"
                  min={1}
                  value={form.timeoutSec}
                  onChange={(e) => setForm({ ...form, timeoutSec: Number(e.target.value) })}
                />
              </label>
              {form.type === "http" && (
                <label>
                  Beklenen HTTP
                  <input value={form.expectedStatus} onChange={(e) => setForm({ ...form, expectedStatus: e.target.value })} placeholder="200" />
                </label>
              )}
              <label>
                Tekrar deneme
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.retries}
                  onChange={(e) => setForm({ ...form, retries: e.target.value })}
                  title="0 = başarıya kadar dene (sınırsız)"
                />
                <span className="muted" style={{ fontSize: 11, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
                  0 = sınırsız (up olana kadar)
                </span>
              </label>
            </div>

            {form.type === "http" && (
              <>
                <button type="button" className="secondary" onClick={() => setShowAdvanced((v) => !v)}>
                  {showAdvanced ? "HTTP seçeneklerini gizle" : "HTTP seçenekleri"}
                </button>
                {showAdvanced && (
                  <div className="grid" style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10, background: "#fafafa" }}>
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
                        Max redirect
                        <input type="number" value={form.maxRedirects} onChange={(e) => setForm({ ...form, maxRedirects: e.target.value })} />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                        <input type="checkbox" checked={form.ignoreTls} onChange={(e) => setForm({ ...form, ignoreTls: e.target.checked })} />
                        TLS doğrulamasını atla
                      </label>
                    </div>
                    <label>
                      Keyword
                      <input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="Body içinde ara…" />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                      <input type="checkbox" checked={form.keywordInvert} onChange={(e) => setForm({ ...form, keywordInvert: e.target.checked })} />
                      Keyword tersine (bulursa fail)
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
              <div className="muted" style={{ marginBottom: 8, fontSize: 12, fontWeight: 650 }}>Hangi node’larda çalışsın?</div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", marginBottom: 10, flex: "0 0 auto" }}>
                <input type="checkbox" checked={form.allNodes} onChange={(e) => setAllNodes(e.target.checked)} />
                <strong>Tüm node’lar</strong>
              </label>
              {!form.allNodes && (
                <div className="row">
                  {nodes.map((n) => (
                    <label key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", flex: "0 0 auto" }}>
                      <input type="checkbox" checked={form.nodeIds.includes(n.id)} onChange={() => toggleNode(n.id)} />
                      {n.name} <span className="muted">({n.location})</span>
                    </label>
                  ))}
                  {!nodes.length && <span className="muted">Önce Nodes’tan probe ekle</span>}
                </div>
              )}
              {form.allNodes && nodes.length > 0 && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {nodes.map((n) => n.location).join(", ")}
                </div>
              )}
            </div>

            <div className="row">
              <button type="submit">{editId ? "Kaydet" : "Oluştur"}</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditId(null);
                }}
              >
                İptal
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Monitör ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" style={{ gap: 6 }}>
          {(
            [
              ["all", "Tüm monitörler"],
              ["up", "Up"],
              ["down", "Down"],
              ["degraded", "Degraded"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={statusFilter === key ? undefined : "secondary"}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted">{filtered.length} monitör</span>
      </div>

      {!filtered.length && <div className="panel"><div className="empty">Monitör yok.</div></div>}

      <div className="monitor-grid">
        {filtered.map((c) => (
          <div key={c.id} className={`monitor-card ${c.lastStatus || ""}`} style={{ cursor: "default" }}>
            <Link to={`/monitors/${c.id}`} style={{ color: "inherit", textDecoration: "none" }}>
              <div className="monitor-top">
                <div>
                  <div className="monitor-name">{c.name}</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{c.service.name}</div>
                </div>
                <span className={`badge ${c.lastStatus || "warn"}`}>{c.lastStatus || "bekliyor"}</span>
              </div>
              <div className="monitor-meta">
                <span className="type-pill">{c.type}</span>
                {c.operator && <span className="type-pill">{c.operator}</span>}
                <span>{c.lastLatencyMs != null ? `${c.lastLatencyMs} ms` : "—"}</span>
                <span>her {Math.round(c.intervalMs / 1000)}s</span>
                <span>{c.nodes.map((n) => n.node.location).join(", ") || "node yok"}</span>
              </div>
              <div className="mono muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 12 }}>
                {c.target}
              </div>
            </Link>
            <div className="row">
              <Link to={`/monitors/${c.id}`}><button className="secondary" type="button">Detay</button></Link>
              <button className="secondary" type="button" onClick={() => startEdit(c)}>Düzenle</button>
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
                Sil
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
