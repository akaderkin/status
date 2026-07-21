import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTenantStatusPayload } from "../lib/status.js";

export async function publicRoutes(app: FastifyInstance) {
  app.get("/v1/:tenant/status", async (request, reply) => {
    const { tenant } = request.params as { tenant: string };
    const payload = await getTenantStatusPayload(tenant);
    if (!payload) return reply.code(404).send({ error: "Tenant not found" });
    return payload;
  });

  app.get("/v1/:tenant/incidents", async (request, reply) => {
    const { tenant: slug } = request.params as { tenant: string };
    const { status } = request.query as { status?: string };
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

    const incidents = await prisma.incident.findMany({
      where: {
        tenantId: tenant.id,
        ...(status === "active" ? { status: { not: "resolved" } } : {}),
        ...(status === "resolved" ? { status: "resolved" } : {}),
      },
      include: {
        services: { include: { service: { select: { id: true, name: true } } } },
      },
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        message: i.message,
        status: i.status,
        source: i.source,
        startedAt: i.startedAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        services: i.services.map((s) => ({ id: s.service.id, name: s.service.name })),
      })),
    };
  });

  app.get("/v1/:tenant/uptime", async (request, reply) => {
    const { tenant: slug } = request.params as { tenant: string };
    const { service: serviceId, from, to } = request.query as {
      service?: string;
      from?: string;
      to?: string;
    };

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const checks = await prisma.check.findMany({
      where: {
        tenantId: tenant.id,
        ...(serviceId ? { serviceId } : {}),
      },
      include: {
        service: { select: { id: true, name: true } },
        results: {
          where: { checkedAt: { gte: fromDate, lte: toDate } },
          select: { status: true },
        },
      },
    });

    const byService = new Map<
      string,
      { serviceId: string; name: string; up: number; total: number }
    >();

    for (const check of checks) {
      const key = check.serviceId;
      const entry = byService.get(key) ?? {
        serviceId: check.serviceId,
        name: check.service.name,
        up: 0,
        total: 0,
      };
      for (const r of check.results) {
        entry.total += 1;
        if (r.status === "up") entry.up += 1;
      }
      byService.set(key, entry);
    }

    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      services: [...byService.values()].map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        samples: s.total,
        uptimePercent: s.total === 0 ? null : Math.round((s.up / s.total) * 10000) / 100,
      })),
    };
  });
}
