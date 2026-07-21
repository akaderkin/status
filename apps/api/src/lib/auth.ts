import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hashToken, safeEqual } from "./crypto.js";
import { prisma } from "./prisma.js";

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function requireAgent(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing agent token" });
  }
  const token = header.slice("Bearer ".length).trim();
  const prefix = token.slice(0, 12);
  const candidates = await prisma.probeNode.findMany({
    where: { tokenPrefix: prefix, enabled: true },
  });

  const hash = hashToken(token);
  const node = candidates.find((n) => safeEqual(n.tokenHash, hash));
  if (!node) {
    return reply.code(401).send({ error: "Invalid agent token" });
  }

  (request as FastifyRequest & { probeNode: typeof node }).probeNode = node;
}

declare module "fastify" {
  interface FastifyRequest {
    probeNode?: {
      id: string;
      name: string;
      location: string;
      tenantId: string | null;
      enabled: boolean;
    };
  }
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("probeNode", undefined);
}
