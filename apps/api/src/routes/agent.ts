import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentHeartbeatSchema, AgentResultsPayloadSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAgent } from "../lib/auth.js";
import { openOrUpdateIncident, recomputeServiceStatus, resolveIncidentsForService } from "../lib/status.js";

function resolveAgentDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "public/agent"),
    path.resolve(process.cwd(), "apps/api/public/agent"),
    path.resolve(here, "../../public/agent"),
    path.resolve(here, "../../../api/public/agent"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

export async function agentRoutes(app: FastifyInstance) {
  const agentDir = resolveAgentDir();

  app.get("/v1/agent/install.sh", async (_req, reply) => {
    const file = path.join(agentDir, "install.sh");
    if (!existsSync(file)) return reply.code(404).send({ error: "install.sh not built; run apps/agent/build-release.sh" });
    reply.header("Content-Type", "text/x-shellscript");
    return reply.send(readFileSync(file, "utf8"));
  });

  app.get("/v1/agent/systemd.service", async (_req, reply) => {
    const file = path.join(agentDir, "status-agent.service");
    if (!existsSync(file)) return reply.code(404).send({ error: "systemd unit missing" });
    reply.header("Content-Type", "text/plain");
    return reply.send(readFileSync(file, "utf8"));
  });

  app.get("/v1/agent/download/:os/:arch", async (request, reply) => {
    const { os, arch } = request.params as { os: string; arch: string };
    const allowedOs = new Set(["linux", "darwin"]);
    const allowedArch = new Set(["amd64", "arm64"]);
    if (!allowedOs.has(os) || !allowedArch.has(arch)) {
      return reply.code(400).send({ error: "Unsupported os/arch" });
    }
    const file = path.join(agentDir, `status-agent-${os}-${arch}`);
    if (!existsSync(file)) {
      return reply.code(404).send({ error: "Binary not found. Run ./apps/agent/build-release.sh" });
    }
    const st = statSync(file);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", st.size);
    reply.header("Content-Disposition", `attachment; filename="status-agent-${os}-${arch}"`);
    return reply.send(createReadStream(file));
  });

  app.get("/v1/agent/meta", async () => {
    const binaries = ["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64"].map((key) => {
      const [os, arch] = key.split("-");
      const file = path.join(agentDir, `status-agent-${os}-${arch}`);
      return {
        os,
        arch,
        available: existsSync(file),
        size: existsSync(file) ? statSync(file).size : 0,
        url: `/v1/agent/download/${os}/${arch}`,
      };
    });
    return {
      version: "1.2.2",
      installScript: "/v1/agent/install.sh",
      systemdUnit: "/v1/agent/systemd.service",
      binaries,
    };
  });

  app.post("/v1/agent/heartbeat", { preHandler: requireAgent }, async (request) => {
    const body = AgentHeartbeatSchema.parse(request.body ?? {});
    const node = request.probeNode!;
    await prisma.probeNode.update({
      where: { id: node.id },
      data: {
        lastHeartbeat: new Date(),
        hostname: body.hostname,
        version: body.version,
      },
    });
    return { ok: true, nodeId: node.id, location: node.location };
  });

  app.get("/v1/agent/checks", { preHandler: requireAgent }, async (request) => {
    const node = request.probeNode!;
    const assignments = await prisma.checkNode.findMany({
      where: { nodeId: node.id, check: { enabled: true } },
      include: {
        check: {
          select: {
            id: true,
            name: true,
            type: true,
            target: true,
            intervalMs: true,
            timeoutMs: true,
            expectedStatus: true,
            config: true,
          },
        },
      },
    });
    return {
      node: { id: node.id, name: node.name, location: node.location },
      checks: assignments.map((a) => a.check),
    };
  });

  app.post("/v1/agent/results", { preHandler: requireAgent }, async (request, reply) => {
    const node = request.probeNode!;
    const body = AgentResultsPayloadSchema.parse(request.body);
    const serviceIds = new Set<string>();

    for (const r of body.results) {
      const assigned = await prisma.checkNode.findUnique({
        where: { checkId_nodeId: { checkId: r.checkId, nodeId: node.id } },
        include: { check: true },
      });
      if (!assigned) continue;

      await prisma.checkResult.create({
        data: {
          checkId: r.checkId,
          nodeId: node.id,
          status: r.status,
          latencyMs: r.latencyMs ?? null,
          message: r.message,
          checkedAt: r.checkedAt ? new Date(r.checkedAt) : new Date(),
        },
      });

      await prisma.check.update({
        where: { id: r.checkId },
        data: {
          lastStatus: r.status,
          lastLatencyMs: r.latencyMs ?? null,
          lastCheckedAt: r.checkedAt ? new Date(r.checkedAt) : new Date(),
          lastMessage: r.message ?? null,
          ...(r.sslExpiresAt !== undefined
            ? { sslExpiresAt: r.sslExpiresAt ? new Date(r.sslExpiresAt) : null }
            : {}),
        },
      });

      serviceIds.add(assigned.check.serviceId);

      if (r.status === "down") {
        await openOrUpdateIncident({
          tenantId: assigned.check.tenantId,
          serviceId: assigned.check.serviceId,
          title: `${assigned.check.name} down from ${node.location}`,
          message: r.message,
          source: "agent",
        });
      }
    }

    for (const serviceId of serviceIds) {
      const status = await recomputeServiceStatus(serviceId);
      if (status === "operational" || status === "maintenance") {
        await resolveIncidentsForService(serviceId, "agent");
      }
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await prisma.checkResult.deleteMany({ where: { checkedAt: { lt: cutoff } } });

    return reply.code(202).send({ ok: true, accepted: body.results.length });
  });
}
