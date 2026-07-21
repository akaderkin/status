import type { FastifyInstance } from "fastify";
import { CreateServiceSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";
import { recomputeServiceStatus } from "../lib/status.js";

export async function serviceRoutes(app: FastifyInstance) {
  app.get("/admin/services", { preHandler: requireAdmin }, async (request) => {
    const { tenantId } = request.query as { tenantId?: string };
    return prisma.service.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: [{ groupName: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: { tenant: { select: { slug: true, name: true } } },
    });
  });

  app.post("/admin/services", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateServiceSchema.parse(request.body);
    const service = await prisma.service.create({
      data: {
        tenantId: body.tenantId,
        name: body.name,
        description: body.description,
        groupName: body.groupName,
        sortOrder: body.sortOrder ?? 0,
        sourceType: body.sourceType ?? "manual",
        status: "unknown",
      },
    });
    return reply.code(201).send(service);
  });

  app.patch("/admin/services/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateServiceSchema.partial().omit({ tenantId: true }).parse(request.body);
    const service = await prisma.service.update({ where: { id }, data: body });
    await recomputeServiceStatus(id);
    return service;
  });

  app.delete("/admin/services/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.service.delete({ where: { id } });
    return reply.code(204).send();
  });
}
