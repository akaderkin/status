import type { FastifyInstance } from "fastify";
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
    const { nodeIds, ...rest } = body;

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
      data: rest,
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
