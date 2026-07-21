import type { FastifyInstance } from "fastify";
import { CreateKumaInstanceSchema, CreateKumaMappingSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";

export async function kumaRoutes(app: FastifyInstance) {
  app.get("/admin/kuma", { preHandler: requireAdmin }, async (request) => {
    const { tenantId } = request.query as { tenantId?: string };
    const rows = await prisma.kumaInstance.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: {
        tenant: { select: { slug: true, name: true } },
        mappings: { include: { service: { select: { id: true, name: true } } } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      ...r,
      apiTokenEnc: undefined,
      hasToken: Boolean(r.apiTokenEnc),
    }));
  });

  app.post("/admin/kuma", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateKumaInstanceSchema.parse(request.body);
    const row = await prisma.kumaInstance.create({
      data: {
        tenantId: body.tenantId,
        name: body.name,
        baseUrl: body.baseUrl.replace(/\/$/, ""),
        apiTokenEnc: encrypt(body.apiToken),
        pollIntervalMs: body.pollIntervalMs ?? 30000,
        enabled: body.enabled ?? true,
      },
    });
    return reply.code(201).send({ ...row, apiTokenEnc: undefined, hasToken: true });
  });

  app.patch("/admin/kuma/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateKumaInstanceSchema.partial().parse(request.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl.replace(/\/$/, "");
    if (body.apiToken !== undefined) data.apiTokenEnc = encrypt(body.apiToken);
    if (body.pollIntervalMs !== undefined) data.pollIntervalMs = body.pollIntervalMs;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.tenantId !== undefined) data.tenantId = body.tenantId;
    const row = await prisma.kumaInstance.update({ where: { id }, data });
    return { ...row, apiTokenEnc: undefined, hasToken: true };
  });

  app.delete("/admin/kuma/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.kumaInstance.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/admin/kuma/mappings", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateKumaMappingSchema.parse(request.body);
    const mapping = await prisma.kumaMonitorMap.create({ data: body });
    await prisma.service.update({
      where: { id: body.serviceId },
      data: { sourceType: "uptime_kuma" },
    });
    return reply.code(201).send(mapping);
  });

  app.delete("/admin/kuma/mappings/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.kumaMonitorMap.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Helper for admin to test decrypt path exists (not exposing token)
  app.get("/admin/kuma/:id/meta", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.kumaInstance.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "Not found" });
    try {
      decrypt(row.apiTokenEnc);
      return { ok: true, baseUrl: row.baseUrl, lastPolledAt: row.lastPolledAt, lastError: row.lastError };
    } catch {
      return { ok: false, error: "Token decrypt failed" };
    }
  });

  app.post("/admin/kuma/:id/test", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.kumaInstance.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "Not found" });
    try {
      const token = decrypt(row.apiTokenEnc);
      const pageSlug = token.startsWith("page:") ? token.slice(5) : null;
      const url = pageSlug
        ? `${row.baseUrl}/api/status-page/heartbeat/${pageSlug}`
        : `${row.baseUrl}/metrics`;
      const headers: Record<string, string> = {};
      if (!pageSlug) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        url,
        preview: text.slice(0, 300),
      };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
