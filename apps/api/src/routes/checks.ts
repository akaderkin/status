import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { CreateCheckSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function checkRoutes(app: FastifyInstance) {
  app.get("/admin/checks", { preHandler: requireAdmin }, async (request) => {
    const { tenantId } = request.query as { tenantId?: string };
    return prisma.check.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: {
        service: { select: { id: true, name: true } },
        nodes: { include: { node: { select: { id: true, name: true, location: true } } } },
        tenant: { select: { slug: true } },
      },
      orderBy: { name: "asc" },
    });
  });

  app.get("/admin/checks/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const check = await prisma.check.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true, status: true } },
        tenant: { select: { id: true, slug: true, name: true } },
        nodes: { include: { node: { select: { id: true, name: true, location: true, lastHeartbeat: true } } } },
      },
    });
    if (!check) return reply.code(404).send({ error: "Check not found" });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent, counts] = await Promise.all([
      prisma.checkResult.findMany({
        where: { checkId: id },
        orderBy: { checkedAt: "desc" },
        take: 60,
        include: { node: { select: { id: true, name: true, location: true } } },
      }),
      prisma.checkResult.groupBy({
        by: ["status"],
        where: { checkId: id, checkedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    let up = 0;
    let total = 0;
    for (const c of counts) {
      total += c._count._all;
      if (c.status === "up") up += c._count._all;
    }

    return {
      ...check,
      uptimePct24h: total > 0 ? Math.round((up / total) * 1000) / 10 : null,
      recentResults: recent,
      sparkline: [...recent].reverse().map((r) => ({
        t: r.checkedAt.toISOString(),
        status: r.status,
        latencyMs: r.latencyMs,
        nodeId: r.nodeId,
      })),
    };
  });

  app.get("/admin/checks/:id/series", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { from?: string; to?: string; bucketMs?: string };
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 6 * 60 * 60 * 1000);
    const bucketMs = Math.max(60_000, Math.min(Number(q.bucketMs) || 5 * 60_000, 60 * 60_000));

    const exists = await prisma.check.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: "Check not found" });

    const results = await prisma.checkResult.findMany({
      where: { checkId: id, checkedAt: { gte: from, lte: to } },
      orderBy: { checkedAt: "asc" },
      select: { status: true, latencyMs: true, checkedAt: true, nodeId: true },
    });

    type Bucket = {
      t: string;
      avgLatencyMs: number | null;
      up: number;
      down: number;
      degraded: number;
      total: number;
    };
    const buckets = new Map<number, Bucket & { latencySum: number; latencyN: number }>();

    for (const r of results) {
      const key = Math.floor(r.checkedAt.getTime() / bucketMs) * bucketMs;
      let b = buckets.get(key);
      if (!b) {
        b = {
          t: new Date(key).toISOString(),
          avgLatencyMs: null,
          up: 0,
          down: 0,
          degraded: 0,
          total: 0,
          latencySum: 0,
          latencyN: 0,
        };
        buckets.set(key, b);
      }
      b.total += 1;
      if (r.status === "up") b.up += 1;
      else if (r.status === "down") b.down += 1;
      else b.degraded += 1;
      if (r.latencyMs != null) {
        b.latencySum += r.latencyMs;
        b.latencyN += 1;
      }
    }

    const series = [...buckets.values()]
      .sort((a, b) => a.t.localeCompare(b.t))
      .map(({ latencySum, latencyN, ...rest }) => ({
        ...rest,
        avgLatencyMs: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
        uptimePct: rest.total > 0 ? Math.round((rest.up / rest.total) * 1000) / 10 : null,
      }));

    return { from: from.toISOString(), to: to.toISOString(), bucketMs, series };
  });

  app.post("/admin/checks", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateCheckSchema.parse(request.body);
    const check = await prisma.check.create({
      data: {
        tenantId: body.tenantId,
        serviceId: body.serviceId,
        name: body.name,
        type: body.type,
        target: body.target,
        intervalMs: body.intervalMs ?? 60000,
        timeoutMs: body.timeoutMs ?? 10000,
        expectedStatus: body.expectedStatus,
        config: (body.config as Prisma.InputJsonValue | undefined) ?? undefined,
        enabled: body.enabled ?? true,
        nodes: body.nodeIds?.length
          ? { create: body.nodeIds.map((nodeId) => ({ nodeId })) }
          : undefined,
      },
      include: { nodes: true },
    });
    await prisma.service.update({
      where: { id: body.serviceId },
      data: { sourceType: "agent" },
    });
    return reply.code(201).send(check);
  });

  app.patch("/admin/checks/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateCheckSchema.partial().omit({ tenantId: true }).parse(request.body);
    const { nodeIds, config, serviceId, ...rest } = body;

    if (nodeIds) {
      await prisma.checkNode.deleteMany({ where: { checkId: id } });
      if (nodeIds.length) {
        await prisma.checkNode.createMany({
          data: nodeIds.map((nodeId) => ({ checkId: id, nodeId })),
        });
      }
    }

    return prisma.check.update({
      where: { id },
      data: {
        ...rest,
        ...(serviceId ? { serviceId } : {}),
        ...(config !== undefined ? { config: config as Prisma.InputJsonValue } : {}),
      },
      include: { nodes: true },
    });
  });

  app.delete("/admin/checks/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.check.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.get("/admin/checks/:id/results", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    return prisma.checkResult.findMany({
      where: { checkId: id },
      orderBy: { checkedAt: "desc" },
      take: Math.min(Number(limit) || 50, 200),
      include: { node: { select: { id: true, name: true, location: true } } },
    });
  });
}
