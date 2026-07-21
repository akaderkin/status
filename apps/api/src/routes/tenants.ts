import type { FastifyInstance } from "fastify";
import { CreateTenantSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function tenantRoutes(app: FastifyInstance) {
  app.get("/admin/tenants", { preHandler: requireAdmin }, async () => {
    return prisma.tenant.findMany({ orderBy: { name: "asc" } });
  });

  app.post("/admin/tenants", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateTenantSchema.parse(request.body);
    const tenant = await prisma.tenant.create({ data: body });
    return reply.code(201).send(tenant);
  });

  app.patch("/admin/tenants/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateTenantSchema.partial().parse(request.body);
    return prisma.tenant.update({ where: { id }, data: body });
  });

  app.delete("/admin/tenants/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.tenant.delete({ where: { id } });
    return reply.code(204).send();
  });
}
