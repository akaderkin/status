import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Tenant = { id: string; name: string };
type Service = { id: string; name: string; tenantId: string };
type Node = { id: string; name: string; location: string };
type Check = {
  id: string; name: string; type: string; target: string; intervalMs: number; timeoutMs: number;
  expectedStatus: number | null; enabled: boolean; tenantId: string; serviceId: string;
  service: { id: string; name: string };
  nodes: Array<{ node: { id: string; name: string; location: string } }>;
};
type Result = {
  id: string; status: string; latencyMs: number | null; message: string | null; checkedAt: string;
  node: { name: string; location: string };
};

export function ChecksPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [rows, setRows] = useState<Check[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [form, setForm] = useState({
    tenantId: "", serviceId: "", name: "", type: "http", target: "",
    intervalMs: 60000, timeoutMs: 10000, expectedStatus: "", nodeIds: [] as string[], enabled: true,
  });
  const [error, setError] = useState("");

  async function load() {
    const [t, s, n, c] = await Promise.all([
      api<Tenant[]>("/admin/tenants"),
      api<Service[]>("/admin/services"),
      api<Node[]>("/admin/nodes"),
      api<Check[]>("/admin/checks"),
    ]);
    setTenants(t); setServices(s); setNodes(n); setRows(c);
    if (!form.tenantId && t[0]) setForm((f) => ({ ...f, tenantId: t[0].id }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  function toggleNode(id: string) {
    setForm((f) => ({
      ...f,
      nodeIds: f.nodeIds.includes(id) ? f.nodeIds.filter((x) => x !== id) : [...f.nodeIds, id],
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
    };
    try {
      if (editId) {
        const { tenantId: _t, ...rest } = payload;
        await api(`/admin/checks/${editId}`, { method: "PATCH", json: rest });
      } else {
        await api("/admin/checks", { method: "POST", json: payload });
      }
      setEditId(null);
      setForm((f) => ({ ...f, name: "", target: "", expectedStatus: "", nodeIds: [] }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function showResults(id: string) {
    setResultsFor(id);
    setResults(await api(`/admin/checks/${id}/results?limit=30`));
  }

  return (
    <>
      <div className="header"><h1>Checks</h1></div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>{editId ? "Edit check" : "Create check"}</h2>
        <form className="grid" onSubmit={onSubmit}>
          <div className="row">
            {!editId && (
              <label>Tenant
                <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <label>Service
              <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                {services.filter((s) => s.tenantId === form.tenantId || editId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="http">http</option>
                <option value="tcp">tcp</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Target<input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required /></label>
          </div>
          <div className="row">
            <label>Interval ms<input type="number" value={form.intervalMs} onChange={(e) => setForm({ ...form, intervalMs: Number(e.target.value) })} /></label>
            <label>Timeout ms<input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} /></label>
            <label>Expected HTTP<input value={form.expectedStatus} onChange={(e) => setForm({ ...form, expectedStatus: e.target.value })} placeholder="200" /></label>
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Run on nodes</div>
            <div className="row">
              {nodes.map((n) => (
                <label key={n.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={form.nodeIds.includes(n.id)} onChange={() => toggleNode(n.id)} />
                  {n.name} ({n.location})
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button type="submit">{editId ? "Save" : "Add check"}</button>
            {editId && <button type="button" className="secondary" onClick={() => setEditId(null)}>Cancel</button>}
          </div>
        </form>
      </div>

      {resultsFor && (
        <div className="panel">
          <h2>Recent results</h2>
          <table>
            <thead><tr><th>Time</th><th>Node</th><th>Status</th><th>Latency</th><th>Message</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.checkedAt).toLocaleString()}</td>
                  <td>{r.node.location}</td>
                  <td><span className={`badge ${r.status === "up" ? "ok" : "err"}`}>{r.status}</span></td>
                  <td>{r.latencyMs ?? "—"}ms</td>
                  <td className="muted">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="secondary" type="button" onClick={() => setResultsFor(null)}>Close</button>
        </div>
      )}

      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Target</th><th>Interval</th><th>Nodes</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="muted">{c.service.name}</div></td>
                <td>{c.type}</td>
                <td className="mono">{c.target}</td>
                <td>{c.intervalMs}ms</td>
                <td>{c.nodes.map((n) => n.node.location).join(", ") || "—"}</td>
                <td className="row">
                  <button className="secondary" type="button" onClick={() => showResults(c.id)}>Results</button>
                  <button className="secondary" type="button" onClick={() => {
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
                    });
                  }}>Edit</button>
                  <button className="danger" type="button" onClick={async () => {
                    await api(`/admin/checks/${c.id}`, { method: "DELETE" });
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
