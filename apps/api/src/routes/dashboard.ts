import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/admin/dashboard", { preHandler: requireAdmin }, async () => {
    const staleMs = Number(process.env.AGENT_STALE_MS || 120000);
    const [
      tenants,
      services,
      openIncidents,
      pendingMaintenances,
      kumaInstances,
      imapAccounts,
      nodes,
      recentMaintenances,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.service.count(),
      prisma.incident.count({ where: { status: { not: "resolved" } } }),
      prisma.maintenance.count({ where: { status: "pending" } }),
      prisma.kumaInstance.findMany({
        select: { id: true, name: true, lastPolledAt: true, lastError: true, enabled: true, tenant: { select: { slug: true } } },
      }),
      prisma.imapAccount.findMany({
        select: { id: true, name: true, lastPolledAt: true, lastError: true, enabled: true },
      }),
      prisma.probeNode.findMany({
        select: { id: true, name: true, location: true, lastHeartbeat: true, enabled: true },
      }),
      prisma.maintenance.findMany({
        where: { emailMessageId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, status: true, emailSubject: true, createdAt: true },
      }),
    ]);

    const now = Date.now();
    return {
      counts: {
        tenants,
        services,
        openIncidents,
        pendingMaintenances,
        nodesOnline: nodes.filter(
          (n) => n.lastHeartbeat && now - n.lastHeartbeat.getTime() < staleMs
        ).length,
        nodesTotal: nodes.length,
      },
      kuma: kumaInstances,
      imap: imapAccounts,
      nodes: nodes.map((n) => ({
        ...n,
        online: n.lastHeartbeat ? now - n.lastHeartbeat.getTime() < staleMs : false,
      })),
      recentEmails: recentMaintenances,
    };
  });
}
