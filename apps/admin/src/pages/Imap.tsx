import { FormEvent, useEffect, useState } from "react";
import { api, apiDelete } from "../api";

type Tenant = { id: string; name: string };
type Imap = {
  id: string; name: string; host: string; port: number; username: string; folder: string;
  enabled: boolean; lastPolledAt: string | null; lastError: string | null;
  fromFilter: string | null; subjectFilter: string | null; tenantId: string | null; secure: boolean;
  pollIntervalMs: number;
  tenant: { slug: string; name: string } | null;
};

export function ImapPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [rows, setRows] = useState<Imap[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    tenantId: "", name: "", host: "", port: 993, secure: true,
    username: "", password: "", folder: "INBOX", fromFilter: "telekom", subjectFilter: "bakım",
    pollIntervalMs: 60000, enabled: true,
  });
  const [testOut, setTestOut] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [t, i] = await Promise.all([api<Tenant[]>("/admin/tenants"), api<Imap[]>("/admin/imap")]);
    setTenants(t); setRows(i);
    if (!form.tenantId && t[0]) setForm((f) => ({ ...f, tenantId: t[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editId) {
        const payload: Record<string, unknown> = { ...form, tenantId: form.tenantId || null };
        if (!form.password) delete payload.password;
        await api(`/admin/imap/${editId}`, { method: "PATCH", json: payload });
      } else {
        await api("/admin/imap", { method: "POST", json: { ...form, tenantId: form.tenantId || null } });
      }
      setEditId(null);
      setForm((f) => ({ ...f, name: "", host: "", username: "", password: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <div className="header"><h1>IMAP / Türk Telekom</h1></div>
      <p className="muted">Bakım mailleri pending gelir → Maintenances’tan onayla.</p>
      {error && <div className="error">{error}</div>}
      {testOut && <div className="panel"><pre className="mono">{testOut}</pre></div>}

      <div className="panel">
        <h2>{editId ? "Edit IMAP" : "Add IMAP account"}</h2>
        <form className="grid" onSubmit={onSubmit}>
          <div className="row">
            <label>Tenant
              <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div className="row">
            <label>Host<input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required /></label>
            <label>Port<input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
            <label>Folder<input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} /></label>
          </div>
          <div className="row">
            <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label>Password {editId ? "(blank=keep)" : ""}
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editId} />
            </label>
          </div>
          <div className="row">
            <label>From filter<input value={form.fromFilter} onChange={(e) => setForm({ ...form, fromFilter: e.target.value })} /></label>
            <label>Subject filter<input value={form.subjectFilter} onChange={(e) => setForm({ ...form, subjectFilter: e.target.value })} /></label>
          </div>
          <div className="row">
            <button type="submit">{editId ? "Save" : "Add IMAP"}</button>
            {editId && <button type="button" className="secondary" onClick={() => setEditId(null)}>Cancel</button>}
          </div>
        </form>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Host</th><th>Filters</th><th>Last poll</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}<div className="muted">{r.tenant?.slug || "shared"} · {r.enabled ? "on" : "off"}</div></td>
                <td className="mono">{r.host}:{r.port}/{r.folder}</td>
                <td className="muted">{r.fromFilter || "—"} / {r.subjectFilter || "—"}</td>
                <td>
                  {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "—"}
                  {r.lastError && <div className="error">{r.lastError}</div>}
                </td>
                <td className="row">
                  <button className="secondary" type="button" onClick={async () => {
                    const res = await api(`/admin/imap/${r.id}/test`, { method: "POST" });
                    setTestOut(JSON.stringify(res, null, 2));
                  }}>Test</button>
                  <button className="secondary" type="button" onClick={() => {
                    setEditId(r.id);
                    setForm({
                      tenantId: r.tenantId || "",
                      name: r.name,
                      host: r.host,
                      port: r.port,
                      secure: r.secure,
                      username: r.username,
                      password: "",
                      folder: r.folder,
                      fromFilter: r.fromFilter || "",
                      subjectFilter: r.subjectFilter || "",
                      pollIntervalMs: r.pollIntervalMs,
                      enabled: r.enabled,
                    });
                  }}>Edit</button>
                  <button className="danger" type="button" onClick={async () => {
                    try {
                      await apiDelete(`/admin/imap/${r.id}`, r.name);
                      await load();
                    } catch (err) {
                      if (err instanceof Error && err.message === "CANCELLED") return;
                      setError(err instanceof Error ? err.message : "Silinemedi");
                    }
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
