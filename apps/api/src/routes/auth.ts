import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { LoginSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/admin/auth/login", async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const user = await prisma.adminUser.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const token = await reply.jwtSign({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  app.get("/admin/auth/me", { preHandler: requireAdmin }, async (request) => {
    const payload = request.user as { sub: string };
    const user = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!user) return { error: "Not found" };
    return { id: user.id, email: user.email, name: user.name };
  });
}
