import { FormEvent, useEffect, useState } from "react";
import { api, apiDelete } from "../api";

type Tenant = { id: string; slug: string; name: string; description: string | null; brandColor: string | null };

export function TenantsPage() {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ slug: "", name: "", description: "", brandColor: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setRows(await api("/admin/tenants"));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editId) {
        await api(`/admin/tenants/${editId}`, {
          method: "PATCH",
          json: {
            name: form.name,
            description: form.description || undefined,
            brandColor: form.brandColor || undefined,
          },
        });
      } else {
        await api("/admin/tenants", {
          method: "POST",
          json: {
            slug: form.slug,
            name: form.name,
            description: form.description || undefined,
            brandColor: form.brandColor || undefined,
          },
        });
      }
      setForm({ slug: "", name: "", description: "", brandColor: "" });
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <>
      <div className="header"><h1>Tenants</h1></div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>{editId ? "Edit tenant" : "Create tenant"}</h2>
        <form className="grid" onSubmit={onSubmit}>
          <div className="row">
            {!editId && (
              <label>Slug<input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required={!editId} /></label>
            )}
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Brand color<input value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} placeholder="#0B5FFF" /></label>
          </div>
          <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></label>
          <div className="row">
            <button type="submit">{editId ? "Save" : "Add"}</button>
            {editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm({ slug: "", name: "", description: "", brandColor: "" }); }}>Cancel</button>}
          </div>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Slug</th><th>Name</th><th>Color</th><th></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.slug}</td>
                <td>{t.name}<div className="muted">{t.description}</div></td>
                <td>{t.brandColor || "—"}</td>
                <td className="row">
                  <button className="secondary" type="button" onClick={() => {
                    setEditId(t.id);
                    setForm({ slug: t.slug, name: t.name, description: t.description || "", brandColor: t.brandColor || "" });
                  }}>Edit</button>
                  <button className="danger" type="button" onClick={async () => {
                    try {
                      await apiDelete(`/admin/tenants/${t.id}`, t.slug);
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
