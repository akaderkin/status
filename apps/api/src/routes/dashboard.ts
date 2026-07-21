import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/admin/dashboard", { preHandler: requireAdmin }, async () => {
    const staleMs = Number(process.env.AGENT_STALE_MS || 120000);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      tenants,
      services,
      openIncidents,
      pendingMaintenances,
      imapAccounts,
      nodes,
      checks,
      recentMaintenances,
      recentFailures,
      resultCounts,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.service.count(),
      prisma.incident.count({ where: { status: { not: "resolved" } } }),
      prisma.maintenance.count({ where: { status: "pending" } }),
      prisma.imapAccount.findMany({
        select: { id: true, name: true, lastPolledAt: true, lastError: true, enabled: true },
      }),
      prisma.probeNode.findMany({
        select: { id: true, name: true, location: true, lastHeartbeat: true, enabled: true },
      }),
      prisma.check.findMany({
        include: {
          service: { select: { id: true, name: true } },
          tenant: { select: { slug: true, name: true } },
          nodes: { include: { node: { select: { id: true, name: true, location: true, lastHeartbeat: true } } } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.maintenance.findMany({
        where: { emailMessageId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, title: true, status: true, emailSubject: true, createdAt: true },
      }),
      prisma.checkResult.findMany({
        where: { status: { in: ["down", "degraded"] }, checkedAt: { gte: since } },
        orderBy: { checkedAt: "desc" },
        take: 20,
        include: {
          check: { select: { id: true, name: true } },
          node: { select: { name: true, location: true } },
        },
      }),
      prisma.checkResult.groupBy({
        by: ["checkId", "status"],
        where: { checkedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const now = Date.now();
    const uptimeByCheck = new Map<string, { up: number; total: number }>();
    for (const row of resultCounts) {
      const cur = uptimeByCheck.get(row.checkId) ?? { up: 0, total: 0 };
      cur.total += row._count._all;
      if (row.status === "up") cur.up += row._count._all;
      uptimeByCheck.set(row.checkId, cur);
    }

    const heartbeats = await prisma.checkResult.findMany({
      where: { checkedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      orderBy: { checkedAt: "desc" },
      take: 2000,
      select: { checkId: true, status: true, latencyMs: true, checkedAt: true, nodeId: true },
    });

    const beatsByCheck = new Map<string, typeof heartbeats>();
    for (const h of heartbeats) {
      const list = beatsByCheck.get(h.checkId) ?? [];
      if (list.length < 40) list.push(h);
      beatsByCheck.set(h.checkId, list);
    }

    return {
      counts: {
        tenants,
        services,
        openIncidents,
        pendingMaintenances,
        checksTotal: checks.length,
        checksDown: checks.filter((c) => c.lastStatus === "down").length,
        checksDegraded: checks.filter((c) => c.lastStatus === "degraded").length,
        nodesOnline: nodes.filter(
          (n) => n.lastHeartbeat && now - n.lastHeartbeat.getTime() < staleMs
        ).length,
        nodesTotal: nodes.length,
      },
      imap: imapAccounts,
      nodes: nodes.map((n) => ({
        ...n,
        online: n.lastHeartbeat ? now - n.lastHeartbeat.getTime() < staleMs : false,
      })),
      monitors: checks.map((c) => {
        const u = uptimeByCheck.get(c.id);
        const uptimePct = u && u.total > 0 ? Math.round((u.up / u.total) * 1000) / 10 : null;
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          target: c.target,
          enabled: c.enabled,
          lastStatus: c.lastStatus,
          lastLatencyMs: c.lastLatencyMs,
          lastCheckedAt: c.lastCheckedAt,
          lastMessage: c.lastMessage,
          sslExpiresAt: c.sslExpiresAt,
          service: c.service,
          tenant: c.tenant,
          nodes: c.nodes.map((n) => ({
            id: n.node.id,
            name: n.node.name,
            location: n.node.location,
            online: n.node.lastHeartbeat
              ? now - n.node.lastHeartbeat.getTime() < staleMs
              : false,
          })),
          uptimePct,
          heartbeats: (beatsByCheck.get(c.id) ?? []).reverse(),
        };
      }),
      recentFailures,
      recentEmails: recentMaintenances,
    };
  });
}
