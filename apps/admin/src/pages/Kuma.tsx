import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Tenant = { id: string; name: string; slug: string };
type Service = { id: string; name: string; tenantId: string };
type Kuma = {
  id: string; name: string; baseUrl: string; enabled: boolean; lastPolledAt: string | null; lastError: string | null;
  tenantId: string; tenant: { slug: string }; pollIntervalMs: number;
  mappings: Array<{ id: string; kumaMonitorId: number; kumaMonitorName: string | null; service: { id: string; name: string } }>;
};

export function KumaPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [rows, setRows] = useState<Kuma[]>([]);
  const [form, setForm] = useState({ tenantId: "", name: "", baseUrl: "", apiToken: "", pollIntervalMs: 30000, enabled: true });
  const [editId, setEditId] = useState<string | null>(null);
  const [mapForm, setMapForm] = useState({ kumaInstanceId: "", serviceId: "", kumaMonitorId: 1, kumaMonitorName: "" });
  const [testOut, setTestOut] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [t, s, k] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
      api<Kuma[]>("/admin/kuma"),
    ]);
    setTenants(t); setServices(s); setRows(k);
    if (!form.tenantId && t[0]) setForm((f) => ({ ...f, tenantId: t[0].id }));
    if (!mapForm.kumaInstanceId && k[0]) setMapForm((f) => ({ ...f, kumaInstanceId: k[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const selectedKuma = rows.find((k) => k.id === mapForm.kumaInstanceId);
  const mapServices = services.filter((s) => !selectedKuma || s.tenantId === selectedKuma.tenantId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editId) {
        const payload: Record<string, unknown> = {
          name: form.name,
          baseUrl: form.baseUrl,
          pollIntervalMs: form.pollIntervalMs,
          enabled: form.enabled,
        };
        if (form.apiToken) payload.apiToken = form.apiToken;
        await api(`/admin/kuma/${editId}`, { method: "PATCH", json: payload });
      } else {
        await api("/admin/kuma", { method: "POST", json: form });
      }
      setEditId(null);
      setForm((f) => ({ ...f, name: "", baseUrl: "", apiToken: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <div className="header"><h1>Uptime Kuma</h1></div>
      <p className="muted">Token: Kuma API key veya public status page için <code>page:slug</code></p>
      {error && <div className="error">{error}</div>}
      {testOut && <div className="panel"><pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{testOut}</pre></div>}

      <div className="panel">
        <h2>{editId ? "Edit instance" : "Add instance"}</h2>
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
            <label>Poll ms<input type="number" value={form.pollIntervalMs} onChange={(e) => setForm({ ...form, pollIntervalMs: Number(e.target.value) })} /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <label>Base URL<input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required /></label>
          <label>API token {editId ? "(leave blank to keep)" : ""}
            <input value={form.apiToken} onChange={(e) => setForm({ ...form, apiToken: e.target.value })} required={!editId} />
          </label>
          <div className="row">
            <button type="submit">{editId ? "Save" : "Add Kuma"}</button>
            {editId && <button type="button" className="secondary" onClick={() => setEditId(null)}>Cancel</button>}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Map monitor → service</h2>
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          await api("/admin/kuma/mappings", {
            method: "POST",
            json: { ...mapForm, kumaMonitorId: Number(mapForm.kumaMonitorId), kumaMonitorName: mapForm.kumaMonitorName || undefined },
          });
          await load();
        }}>
          <label>Kuma
            <select value={mapForm.kumaInstanceId} onChange={(e) => setMapForm({ ...mapForm, kumaInstanceId: e.target.value })}>
              {rows.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label>Service
            <select value={mapForm.serviceId} onChange={(e) => setMapForm({ ...mapForm, serviceId: e.target.value })}>
              {mapServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Monitor ID<input type="number" value={mapForm.kumaMonitorId} onChange={(e) => setMapForm({ ...mapForm, kumaMonitorId: Number(e.target.value) })} /></label>
          <label>Monitor name<input value={mapForm.kumaMonitorName} onChange={(e) => setMapForm({ ...mapForm, kumaMonitorName: e.target.value })} /></label>
          <button type="submit">Map</button>
        </form>
      </div>

      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>URL</th><th>Last poll</th><th>Mappings</th><th></th></tr></thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id}>
                <td>{k.name}<div className="muted">{k.tenant.slug} · {k.enabled ? "on" : "off"}</div></td>
                <td className="mono">{k.baseUrl}</td>
                <td>
                  {k.lastPolledAt ? new Date(k.lastPolledAt).toLocaleString() : "—"}
                  {k.lastError && <div className="error">{k.lastError}</div>}
                </td>
                <td>
                  {k.mappings.map((m) => (
                    <div key={m.id} className="row" style={{ marginBottom: 4 }}>
                      <span>#{m.kumaMonitorId} → {m.service.name}</span>
                      <button className="danger" type="button" onClick={async () => {
                        await api(`/admin/kuma/mappings/${m.id}`, { method: "DELETE" });
                        await load();
                      }}>×</button>
                    </div>
                  ))}
                </td>
                <td className="row">
                  <button className="secondary" type="button" onClick={async () => {
                    const res = await api(`/admin/kuma/${k.id}/test`, { method: "POST" });
                    setTestOut(JSON.stringify(res, null, 2));
                  }}>Test</button>
                  <button className="secondary" type="button" onClick={() => {
                    setEditId(k.id);
                    setForm({
                      tenantId: k.tenantId,
                      name: k.name,
                      baseUrl: k.baseUrl,
                      apiToken: "",
                      pollIntervalMs: k.pollIntervalMs,
                      enabled: k.enabled,
                    });
                  }}>Edit</button>
                  <button className="danger" type="button" onClick={async () => {
                    await api(`/admin/kuma/${k.id}`, { method: "DELETE" });
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
