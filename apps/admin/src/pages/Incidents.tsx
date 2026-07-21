import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Tenant = { id: string; name: string };
type Service = { id: string; name: string; tenantId: string };
type Incident = {
  id: string; title: string; message: string | null; status: string; source: string;
  startedAt: string; resolvedAt: string | null;
  tenant: { slug: string };
  services: Array<{ service: { id: string; name: string } }>;
};

const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;

export function IncidentsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [rows, setRows] = useState<Incident[]>([]);
  const [form, setForm] = useState({ tenantId: "", title: "", message: "", serviceIds: [] as string[] });
  const [error, setError] = useState("");

  async function load() {
    const [t, s, i] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
      api<Incident[]>("/admin/incidents"),
    ]);
    setTenants(t); setServices(s); setRows(i);
    if (!form.tenantId && t[0]) setForm((f) => ({ ...f, tenantId: t[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/admin/incidents", { method: "POST", json: form });
      setForm((f) => ({ ...f, title: "", message: "", serviceIds: [] }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <div className="header"><h1>Incidents</h1></div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Manual incident</h2>
        <form className="grid" onSubmit={onCreate}>
          <div className="row">
            <label>Tenant
              <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          </div>
          <label>Message<textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} /></label>
          <div className="row">
            {services.filter((s) => s.tenantId === form.tenantId).map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={form.serviceIds.includes(s.id)}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      serviceIds: f.serviceIds.includes(s.id)
                        ? f.serviceIds.filter((x) => x !== s.id)
                        : [...f.serviceIds, s.id],
                    }))
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
          <button type="submit">Create</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Title</th><th>Tenant</th><th>Source</th><th>Status</th><th>Started</th><th></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.title}
                  <div className="muted">{i.message}</div>
                  <div className="muted">{i.services.map((s) => s.service.name).join(", ")}</div>
                </td>
                <td>{i.tenant.slug}</td>
                <td>{i.source}</td>
                <td>
                  <select
                    value={i.status}
                    onChange={async (e) => {
                      await api(`/admin/incidents/${i.id}`, { method: "PATCH", json: { status: e.target.value } });
                      await load();
                    }}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>{new Date(i.startedAt).toLocaleString()}</td>
                <td>
                  {i.status !== "resolved" && (
                    <button type="button" onClick={async () => {
                      await api(`/admin/incidents/${i.id}`, { method: "PATCH", json: { status: "resolved" } });
                      await load();
                    }}>Resolve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
