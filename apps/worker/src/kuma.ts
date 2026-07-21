import { kumaStatusToComponent } from "@status/shared";
import { decrypt, prisma } from "./lib/common.js";

type KumaHeartbeat = {
  status?: number;
  time?: string;
  msg?: string;
  ping?: number;
};

type KumaMonitor = {
  id: number;
  name?: string;
  active?: boolean;
};

/**
 * Poll Uptime Kuma via its metrics/status page JSON endpoint.
 * Supports status page API: GET {base}/api/status-page/heartbeat/{slug}
 * and authenticated monitor list via Socket-less REST where available.
 *
 * Primary approach: call `{baseUrl}/api/status-page/heartbeat/{pageSlug}` if configured
 * in the token field as `statuspage:<slug>` OR use badge/status endpoints.
 *
 * For API key style installs we use: GET {base}/metrics with Bearer if provided,
 * falling back to public monitor heartbeat push stored mappings.
 *
 * Practical MVP: GET `{baseUrl}/api/entry-page` is not stable; instead we poll
 * each mapped monitor via `{baseUrl}/api/badge/{id}/status` HTML/text OR
 * `{baseUrl}/api/status-page/heartbeat/default` style.
 *
 * We implement a resilient strategy:
 * 1) Try `/api/status-page/heartbeat/{slug}` where slug is optional suffix of token `page:slug`
 * 2) Else try fetching `/metrics` Prometheus and parse monitor gauges
 * 3) Else hit `/api/badge/{monitorId}/status` for each mapping
 */
export async function pollKumaInstances() {
  const instances = await prisma.kumaInstance.findMany({
    where: { enabled: true },
    include: { mappings: { include: { service: true } } },
  });

  for (const instance of instances) {
    try {
      const token = decrypt(instance.apiTokenEnc);
      const pageSlug = token.startsWith("page:") ? token.slice(5) : null;
      const authToken = pageSlug ? null : token;

      if (pageSlug) {
        await pollStatusPage(instance, pageSlug);
      } else {
        await pollMappedMonitors(instance, authToken);
      }

      await prisma.kumaInstance.update({
        where: { id: instance.id },
        data: { lastPolledAt: new Date(), lastError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[kuma] ${instance.name}: ${message}`);
      await prisma.kumaInstance.update({
        where: { id: instance.id },
        data: { lastError: message.slice(0, 2000), lastPolledAt: new Date() },
      });
    }
  }
}

async function pollStatusPage(
  instance: {
    id: string;
    baseUrl: string;
    tenantId: string;
    mappings: Array<{
      kumaMonitorId: number;
      serviceId: string;
      service: { id: string; name: string; tenantId: string };
    }>;
  },
  pageSlug: string
) {
  const url = `${instance.baseUrl}/api/status-page/heartbeat/${pageSlug}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`status-page heartbeat HTTP ${res.status}`);
  const data = (await res.json()) as {
    heartbeatList?: Record<string, KumaHeartbeat[]>;
  };

  for (const mapping of instance.mappings) {
    const list = data.heartbeatList?.[String(mapping.kumaMonitorId)] ?? [];
    const latest = list[list.length - 1];
    if (!latest || latest.status === undefined) continue;
    await applyMonitorStatus(mapping, latest.status, latest.msg);
  }
}

async function pollMappedMonitors(
  instance: {
    id: string;
    baseUrl: string;
    tenantId: string;
    mappings: Array<{
      kumaMonitorId: number;
      serviceId: string;
      service: { id: string; name: string; tenantId: string };
    }>;
  },
  authToken: string | null
) {
  // Try prometheus metrics first
  const metricsUrl = `${instance.baseUrl}/metrics`;
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let usedMetrics = false;
  try {
    const res = await fetch(metricsUrl, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const text = await res.text();
      const statusById = parsePrometheusMonitorStatus(text);
      if (Object.keys(statusById).length > 0) {
        usedMetrics = true;
        for (const mapping of instance.mappings) {
          const st = statusById[mapping.kumaMonitorId];
          if (st === undefined) continue;
          await applyMonitorStatus(mapping, st);
        }
      }
    }
  } catch {
    // fall through
  }

  if (usedMetrics) return;

  // Fallback: badge status endpoint per monitor
  for (const mapping of instance.mappings) {
    const badgeUrl = `${instance.baseUrl}/api/badge/${mapping.kumaMonitorId}/status`;
    const res = await fetch(badgeUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) continue;
    const text = (await res.text()).toLowerCase();
    let statusNum = 2;
    if (text.includes("up")) statusNum = 1;
    else if (text.includes("down")) statusNum = 0;
    else if (text.includes("maintenance")) statusNum = 3;
    await applyMonitorStatus(mapping, statusNum);
  }
}

function parsePrometheusMonitorStatus(text: string): Record<number, number> {
  const out: Record<number, number> = {};
  // monitor_status{monitor_id="1",monitor_name="...",monitor_type="...",monitor_url="...",monitor_hostname="...",monitor_port=""} 1
  const re =
    /monitor_status\{[^}]*monitor_id="(\d+)"[^}]*\}\s+(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

async function applyMonitorStatus(
  mapping: {
    serviceId: string;
    service: { id: string; name: string; tenantId: string };
  },
  kumaStatus: number,
  message?: string
) {
  const component = kumaStatusToComponent(kumaStatus);
  await prisma.service.update({
    where: { id: mapping.serviceId },
    data: { status: component, sourceType: "uptime_kuma" },
  });

  if (component === "major_outage" || component === "partial_outage") {
    const open = await prisma.incident.findFirst({
      where: {
        tenantId: mapping.service.tenantId,
        status: { not: "resolved" },
        source: "kuma",
        services: { some: { serviceId: mapping.serviceId } },
      },
    });
    if (!open) {
      await prisma.incident.create({
        data: {
          tenantId: mapping.service.tenantId,
          title: `${mapping.service.name} outage detected`,
          message: message || `Uptime Kuma status=${kumaStatus}`,
          source: "kuma",
          status: "investigating",
          services: { create: [{ serviceId: mapping.serviceId }] },
        },
      });
    }
  } else if (component === "operational" || component === "maintenance") {
    const open = await prisma.incident.findMany({
      where: {
        status: { not: "resolved" },
        source: "kuma",
        services: { some: { serviceId: mapping.serviceId } },
      },
    });
    for (const inc of open) {
      await prisma.incident.update({
        where: { id: inc.id },
        data: { status: "resolved", resolvedAt: new Date() },
      });
    }
  }
}

// keep type reference for future use
void (null as unknown as KumaMonitor);
