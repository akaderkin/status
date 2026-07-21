import type { FastifyInstance } from "fastify";
import { ApproveMaintenanceSchema, CreateMaintenanceSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";
import { recomputeServiceStatus } from "../lib/status.js";

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get("/admin/maintenances", { preHandler: requireAdmin }, async (request) => {
    const { tenantId, status } = request.query as { tenantId?: string; status?: string };
    return prisma.maintenance.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: {
        tenant: { select: { slug: true, name: true } },
        services: { include: { service: { select: { id: true, name: true } } } },
      },
      orderBy: { startsAt: "desc" },
      take: 100,
    });
  });

  app.post("/admin/maintenances", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateMaintenanceSchema.parse(request.body);
    const m = await prisma.maintenance.create({
      data: {
        tenantId: body.tenantId,
        title: body.title,
        summary: body.summary,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        status: body.status ?? "approved",
        services: body.serviceIds?.length
          ? { create: body.serviceIds.map((serviceId) => ({ serviceId })) }
          : undefined,
      },
      include: { services: true },
    });
    for (const sid of body.serviceIds ?? []) {
      await recomputeServiceStatus(sid);
    }
    return reply.code(201).send(m);
  });

  app.post("/admin/maintenances/:id/approve", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ApproveMaintenanceSchema.parse(request.body ?? {});
    const existing = await prisma.maintenance.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    if (body.serviceIds) {
      await prisma.maintenanceService.deleteMany({ where: { maintenanceId: id } });
      if (body.serviceIds.length) {
        await prisma.maintenanceService.createMany({
          data: body.serviceIds.map((serviceId) => ({ maintenanceId: id, serviceId })),
        });
      }
    }

    const updated = await prisma.maintenance.update({
      where: { id },
      data: {
        status: "approved",
        title: body.title ?? existing.title,
        summary: body.summary ?? existing.summary,
        startsAt: body.startsAt ? new Date(body.startsAt) : existing.startsAt,
        endsAt: body.endsAt ? new Date(body.endsAt) : existing.endsAt,
      },
      include: { services: true },
    });

    const links = await prisma.maintenanceService.findMany({ where: { maintenanceId: id } });
    for (const link of links) {
      await recomputeServiceStatus(link.serviceId);
    }

    return updated;
  });

  app.post("/admin/maintenances/:id/cancel", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await prisma.maintenance.update({
      where: { id },
      data: { status: "cancelled" },
      include: { services: true },
    });
    for (const s of updated.services) {
      await recomputeServiceStatus(s.serviceId);
    }
    return updated;
  });

  app.delete("/admin/maintenances/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const links = await prisma.maintenanceService.findMany({ where: { maintenanceId: id } });
    await prisma.maintenance.delete({ where: { id } });
    for (const link of links) {
      await recomputeServiceStatus(link.serviceId);
    }
    return { ok: true };
  });
}
