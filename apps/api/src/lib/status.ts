import {
  aggregateOverallStatus,
  checkResultsToComponent,
  type ComponentStatus,
  type OverallStatus,
} from "@status/shared";
import type { CheckResultStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type ServiceWithRelations = Prisma.ServiceGetPayload<{
  include: {
    checks: {
      include: {
        results: true;
        nodes: true;
      };
    };
    maintenances: {
      include: { maintenance: true };
    };
  };
}>;

export async function recomputeServiceStatus(serviceId: string): Promise<ComponentStatus> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      checks: {
        where: { enabled: true },
        include: {
          nodes: true,
          results: {
            orderBy: { checkedAt: "desc" },
            take: 20,
          },
        },
      },
      maintenances: {
        include: { maintenance: true },
      },
    },
  });

  if (!service) return "unknown";

  const now = new Date();
  const activeMaintenance = service.maintenances.some(
    (ms) =>
      (ms.maintenance.status === "approved" || ms.maintenance.status === "active") &&
      ms.maintenance.startsAt <= now &&
      ms.maintenance.endsAt >= now
  );

  if (activeMaintenance) {
    await prisma.service.update({
      where: { id: serviceId },
      data: { status: "maintenance" },
    });
    return "maintenance";
  }

  // Prefer latest result per node for agent checks
  const latestByNode: Array<{ status: CheckResultStatus }> = [];
  for (const check of service.checks) {
    const seen = new Set<string>();
    for (const r of check.results) {
      if (seen.has(r.nodeId)) continue;
      seen.add(r.nodeId);
      latestByNode.push({ status: r.status });
    }
  }

  let status: ComponentStatus =
    latestByNode.length > 0 ? checkResultsToComponent(latestByNode) : service.status;

  // Keep kuma/manual status if no agent results
  if (latestByNode.length === 0 && service.sourceType !== "agent") {
    status = service.status as ComponentStatus;
  }

  await prisma.service.update({
    where: { id: serviceId },
    data: { status },
  });

  return status;
}

export async function getTenantStatusPayload(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: {
      services: { orderBy: [{ groupName: "asc" }, { sortOrder: "asc" }, { name: "asc" }] },
      maintenances: {
        where: {
          status: { in: ["approved", "active"] },
          endsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
        include: { services: { include: { service: true } } },
      },
      incidents: {
        where: { status: { not: "resolved" } },
        orderBy: { startedAt: "desc" },
        include: { services: { include: { service: true } } },
        take: 20,
      },
    },
  });

  if (!tenant) return null;

  const statuses = tenant.services.map((s) => s.status as ComponentStatus);
  const overall: OverallStatus = aggregateOverallStatus(statuses);

  return {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      description: tenant.description,
      brandColor: tenant.brandColor,
    },
    overall,
    updatedAt: new Date().toISOString(),
    components: tenant.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      group: s.groupName,
      status: s.status,
    })),
    maintenances: tenant.maintenances.map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.summary,
      status: m.status,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      services: m.services.map((x) => ({ id: x.service.id, name: x.service.name })),
    })),
    incidents: tenant.incidents.map((i) => ({
      id: i.id,
      title: i.title,
      message: i.message,
      status: i.status,
      source: i.source,
      startedAt: i.startedAt.toISOString(),
      services: i.services.map((x) => ({ id: x.service.id, name: x.service.name })),
    })),
  };
}

export async function openOrUpdateIncident(opts: {
  tenantId: string;
  serviceId: string;
  title: string;
  message?: string;
  source: "kuma" | "agent" | "manual" | "maintenance";
}) {
  const open = await prisma.incident.findFirst({
    where: {
      tenantId: opts.tenantId,
      status: { not: "resolved" },
      source: opts.source,
      services: { some: { serviceId: opts.serviceId } },
    },
  });

  if (open) {
    return open;
  }

  return prisma.incident.create({
    data: {
      tenantId: opts.tenantId,
      title: opts.title,
      message: opts.message,
      source: opts.source,
      status: "investigating",
      services: { create: [{ serviceId: opts.serviceId }] },
    },
  });
}

export async function resolveIncidentsForService(
  serviceId: string,
  source: "kuma" | "agent"
) {
  const open = await prisma.incident.findMany({
    where: {
      status: { not: "resolved" },
      source,
      services: { some: { serviceId } },
    },
  });

  for (const inc of open) {
    await prisma.incident.update({
      where: { id: inc.id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
  }
}
