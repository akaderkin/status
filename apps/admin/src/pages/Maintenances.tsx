import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Service = { id: string; name: string; tenantId: string };
type Tenant = { id: string; name: string };
type Maintenance = {
  id: string; title: string; summary: string | null; status: string;
  startsAt: string; endsAt: string; emailSubject: string | null; emailFrom: string | null; emailBody: string | null;
  tenant: { slug: string; name: string };
  services: Array<{ service: { id: string; name: string } }>;
  tenantId: string;
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MaintenancesPage() {
  const [rows, setRows] = useState<Maintenance[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState<Maintenance | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [approveForm, setApproveForm] = useState({ title: "", summary: "", startsAt: "", endsAt: "" });
  const [manual, setManual] = useState({
    tenantId: "", title: "", summary: "", startsAt: "", endsAt: "", serviceIds: [] as string[],
  });
  const [error, setError] = useState("");

  async function load() {
    const [m, s, t] = await Promise.all([
      api<Maintenance[]>("/admin/maintenances"),
      api<Service[]>("/admin/services"),
      api<Tenant[]>("/admin/tenants"),
    ]);
    setRows(m); setServices(s); setTenants(t);
    if (!manual.tenantId && t[0]) setManual((f) => ({ ...f, tenantId: t[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function approve(m: Maintenance) {
    try {
      await api(`/admin/maintenances/${m.id}/approve`, {
        method: "POST",
        json: {
          serviceIds,
          title: approveForm.title || undefined,
          summary: approveForm.summary || undefined,
          startsAt: approveForm.startsAt ? new Date(approveForm.startsAt).toISOString() : undefined,
          endsAt: approveForm.endsAt ? new Date(approveForm.endsAt).toISOString() : undefined,
        },
      });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function createManual(e: FormEvent) {
    e.preventDefault();
    await api("/admin/maintenances", {
      method: "POST",
      json: {
        tenantId: manual.tenantId,
        title: manual.title,
        summary: manual.summary,
        startsAt: new Date(manual.startsAt).toISOString(),
        endsAt: new Date(manual.endsAt).toISOString(),
        status: "approved",
        serviceIds: manual.serviceIds,
      },
    });
    setManual((f) => ({ ...f, title: "", summary: "", startsAt: "", endsAt: "", serviceIds: [] }));
    await load();
  }

  return (
    <>
      <div className="header"><h1>Maintenances</h1></div>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>Manual maintenance</h2>
        <form className="grid" onSubmit={createManual}>
          <div className="row">
            <label>Tenant
              <select value={manual.tenantId} onChange={(e) => setManual({ ...manual, tenantId: e.target.value })}>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Title<input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} required /></label>
          </div>
          <div className="row">
            <label>Starts<input type="datetime-local" value={manual.startsAt} onChange={(e) => setManual({ ...manual, startsAt: e.target.value })} required /></label>
            <label>Ends<input type="datetime-local" value={manual.endsAt} onChange={(e) => setManual({ ...manual, endsAt: e.target.value })} required /></label>
          </div>
          <label>Summary<textarea value={manual.summary} onChange={(e) => setManual({ ...manual, summary: e.target.value })} rows={2} /></label>
          <div className="row">
            {services.filter((s) => s.tenantId === manual.tenantId).map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={manual.serviceIds.includes(s.id)}
                  onChange={() =>
                    setManual((f) => ({
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
          <button type="submit">Create approved</button>
        </form>
      </div>

      {selected && (
        <div className="panel">
          <h2>Approve: {selected.title}</h2>
          <p className="muted">{selected.emailFrom}</p>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>
            {selected.emailBody || selected.summary}
          </pre>
          <div className="row">
            <label>Title<input value={approveForm.title} onChange={(e) => setApproveForm({ ...approveForm, title: e.target.value })} /></label>
            <label>Starts<input type="datetime-local" value={approveForm.startsAt} onChange={(e) => setApproveForm({ ...approveForm, startsAt: e.target.value })} /></label>
            <label>Ends<input type="datetime-local" value={approveForm.endsAt} onChange={(e) => setApproveForm({ ...approveForm, endsAt: e.target.value })} /></label>
          </div>
          <label>Summary<textarea value={approveForm.summary} onChange={(e) => setApproveForm({ ...approveForm, summary: e.target.value })} rows={2} /></label>
          <div className="row" style={{ margin: "0.75rem 0" }}>
            {services.filter((s) => s.tenantId === selected.tenantId).map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(s.id)}
                  onChange={() =>
                    setServiceIds((ids) =>
                      ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id]
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => approve(selected)}>Approve</button>
            <button className="secondary" type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="panel">
        <table>
          <thead><tr><th>Title</th><th>Tenant</th><th>Window</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.title}
                  {m.emailSubject && <div className="muted">mail: {m.emailSubject}</div>}
                  <div className="muted">{m.services.map((s) => s.service.name).join(", ")}</div>
                </td>
                <td>{m.tenant.slug}</td>
                <td>{new Date(m.startsAt).toLocaleString()} → {new Date(m.endsAt).toLocaleString()}</td>
                <td><span className={`badge ${m.status === "pending" ? "warn" : "ok"}`}>{m.status}</span></td>
                <td className="row">
                  {m.status === "pending" && (
                    <button type="button" onClick={() => {
                      setSelected(m);
                      setServiceIds(m.services.map((s) => s.service.id));
                      setApproveForm({
                        title: m.title,
                        summary: m.summary || "",
                        startsAt: toLocalInput(m.startsAt),
                        endsAt: toLocalInput(m.endsAt),
                      });
                    }}>Review</button>
                  )}
                  <button className="secondary" type="button" onClick={async () => {
                    await api(`/admin/maintenances/${m.id}/cancel`, { method: "POST" });
                    await load();
                  }}>Cancel</button>
                  <button className="danger" type="button" onClick={async () => {
                    await api(`/admin/maintenances/${m.id}`, { method: "DELETE" });
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
