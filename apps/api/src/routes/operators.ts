import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

const CreateOperatorSchema = z.object({
  name: z.string().min(1).max(128).trim(),
});

export async function operatorRoutes(app: FastifyInstance) {
  app.get("/admin/operators", { preHandler: requireAdmin }, async () => {
    return prisma.operator.findMany({ orderBy: { name: "asc" } });
  });

  app.post("/admin/operators", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateOperatorSchema.parse(request.body);
    const name = body.name.trim();
    const existing = await prisma.operator.findUnique({ where: { name } });
    if (existing) return existing;
    const row = await prisma.operator.create({ data: { name } });
    return reply.code(201).send(row);
  });

  app.delete("/admin/operators/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.operator.delete({ where: { id } });
    return { ok: true };
  });
}
