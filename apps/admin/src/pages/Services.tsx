import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Tenant = { id: string; slug: string; name: string };
type Service = {
  id: string; name: string; description: string | null; groupName: string | null;
  status: string; sourceType: string; sortOrder: number; tenantId: string;
  tenant: { slug: string; name: string };
};

export function ServicesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [rows, setRows] = useState<Service[]>([]);
  const [filterTenant, setFilterTenant] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    tenantId: "", name: "", description: "", groupName: "", sortOrder: 0, sourceType: "manual",
  });
  const [error, setError] = useState("");

  async function load() {
    const [t, s] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
    ]);
    setTenants(t);
    setRows(s);
    if (!form.tenantId && t[0]) setForm((f) => ({ ...f, tenantId: t[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const visible = filterTenant ? rows.filter((r) => r.tenantId === filterTenant) : rows;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editId) {
        await api(`/admin/services/${editId}`, {
          method: "PATCH",
          json: {
            name: form.name,
            description: form.description || undefined,
            groupName: form.groupName || undefined,
            sortOrder: Number(form.sortOrder),
            sourceType: form.sourceType,
          },
        });
      } else {
        await api("/admin/services", {
          method: "POST",
          json: {
            tenantId: form.tenantId,
            name: form.name,
            description: form.description || undefined,
            groupName: form.groupName || undefined,
            sortOrder: Number(form.sortOrder),
            sourceType: form.sourceType,
          },
        });
      }
      setEditId(null);
      setForm((f) => ({ ...f, name: "", description: "", groupName: "", sortOrder: 0 }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <div className="header">
        <h1>Services</h1>
        <select value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)}>
          <option value="">All tenants</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>{editId ? "Edit service" : "Add service"}</h2>
        <form className="grid" onSubmit={onSubmit}>
          <div className="row">
            {!editId && (
              <label>Tenant
                <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Group<input value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} /></label>
            <label>Sort<input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label>
            <label>Source
              <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
                <option value="manual">manual</option>
                <option value="agent">agent</option>
              </select>
            </label>
          </div>
          <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></label>
          <div className="row">
            <button type="submit">{editId ? "Save" : "Add"}</button>
            {editId && <button type="button" className="secondary" onClick={() => setEditId(null)}>Cancel</button>}
          </div>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Tenant</th><th>Name</th><th>Group</th><th>Source</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id}>
                <td>{s.tenant.slug}</td>
                <td>{s.name}</td>
                <td>{s.groupName || "—"}</td>
                <td>{s.sourceType}</td>
                <td><span className="badge">{s.status}</span></td>
                <td className="row">
                  <button className="secondary" type="button" onClick={() => {
                    setEditId(s.id);
                    setForm({
                      tenantId: s.tenantId,
                      name: s.name,
                      description: s.description || "",
                      groupName: s.groupName || "",
                      sortOrder: s.sortOrder,
                      sourceType: s.sourceType,
                    });
                  }}>Edit</button>
                  <button className="danger" type="button" onClick={async () => {
                    if (!confirm("Delete?")) return;
                    await api(`/admin/services/${s.id}`, { method: "DELETE" });
                    await load();
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
