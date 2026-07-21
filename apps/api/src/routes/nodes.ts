import type { FastifyInstance } from "fastify";
import { CreateProbeNodeSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";
import { generateNodeToken } from "../lib/crypto.js";

export async function nodeRoutes(app: FastifyInstance) {
  app.get("/admin/nodes", { preHandler: requireAdmin }, async () => {
    const staleMs = Number(process.env.AGENT_STALE_MS || 120000);
    const nodes = await prisma.probeNode.findMany({
      include: { tenant: { select: { slug: true, name: true } }, _count: { select: { checks: true } } },
      orderBy: { name: "asc" },
    });
    const now = Date.now();
    return nodes.map((n) => ({
      ...n,
      tokenHash: undefined,
      online: n.lastHeartbeat
        ? now - n.lastHeartbeat.getTime() < staleMs
        : false,
    }));
  });

  app.post("/admin/nodes", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateProbeNodeSchema.parse(request.body);
    const { token, prefix, hash } = generateNodeToken();
    const node = await prisma.probeNode.create({
      data: {
        name: body.name,
        location: body.location,
        tenantId: body.tenantId ?? null,
        enabled: body.enabled ?? true,
        tokenHash: hash,
        tokenPrefix: prefix,
      },
    });
    return reply.code(201).send({
      ...node,
      tokenHash: undefined,
      token, // shown once
    });
  });

  app.post("/admin/nodes/:id/rotate-token", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const { token, prefix, hash } = generateNodeToken();
    const node = await prisma.probeNode.update({
      where: { id },
      data: { tokenHash: hash, tokenPrefix: prefix },
    });
    return { ...node, tokenHash: undefined, token };
  });

  app.patch("/admin/nodes/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateProbeNodeSchema.partial().parse(request.body);
    const node = await prisma.probeNode.update({ where: { id }, data: body });
    return { ...node, tokenHash: undefined };
  });

  app.delete("/admin/nodes/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.probeNode.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/admin/nodes/:id/install-command", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { token?: string; apiUrl?: string };
    const node = await prisma.probeNode.findUnique({ where: { id } });
    if (!node) return reply.code(404).send({ error: "Not found" });

    const apiUrl = (body.apiUrl || process.env.PUBLIC_API_URL || `http://localhost:${process.env.API_PORT || 3000}`).replace(/\/$/, "");
    const token = body.token;
    if (!token) {
      return reply.code(400).send({
        error: "Pass the plaintext token (only available at create/rotate time)",
        hint: "Rotate token to get a new one, then call this again with { token, apiUrl }",
      });
    }

    const linux = `curl -fsSL "${apiUrl}/v1/agent/install.sh" | sudo bash -s -- --api-url "${apiUrl}" --token "${token}"`;
    const docker = `docker run -d --name status-agent-${node.location} --restart=always \\\n  -e STATUS_API_URL=${apiUrl} \\\n  -e NODE_TOKEN=${token} \\\n  ghcr.io/olfe/status-agent:latest`;
    const manual = `STATUS_API_URL=${apiUrl} NODE_TOKEN=${token} ./status-agent`;

    return {
      node: { id: node.id, name: node.name, location: node.location },
      apiUrl,
      commands: { linux, docker, manual },
    };
  });
}
