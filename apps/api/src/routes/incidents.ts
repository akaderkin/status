import type { FastifyInstance } from "fastify";
import { CreateIncidentSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function incidentRoutes(app: FastifyInstance) {
  app.get("/admin/incidents", { preHandler: requireAdmin }, async (request) => {
    const { tenantId } = request.query as { tenantId?: string };
    return prisma.incident.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: {
        services: { include: { service: { select: { id: true, name: true } } } },
        tenant: { select: { slug: true, name: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
  });

  app.post("/admin/incidents", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateIncidentSchema.parse(request.body);
    const incident = await prisma.incident.create({
      data: {
        tenantId: body.tenantId,
        title: body.title,
        message: body.message,
        status: body.status ?? "investigating",
        source: body.source ?? "manual",
        services: body.serviceIds?.length
          ? { create: body.serviceIds.map((serviceId) => ({ serviceId })) }
          : undefined,
      },
      include: { services: true },
    });
    return reply.code(201).send(incident);
  });

  app.patch("/admin/incidents/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateIncidentSchema.partial()
      .omit({ tenantId: true, serviceIds: true })
      .extend({
        status: CreateIncidentSchema.shape.status,
      })
      .parse(request.body);

    const data: Record<string, unknown> = { ...body };
    if (body.status === "resolved") data.resolvedAt = new Date();

    return prisma.incident.update({
      where: { id },
      data,
      include: { services: { include: { service: true } } },
    });
  });
}
