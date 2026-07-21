import { z } from "zod";

export const ComponentStatus = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown",
]);
export type ComponentStatus = z.infer<typeof ComponentStatus>;

export const OverallStatus = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
]);
export type OverallStatus = z.infer<typeof OverallStatus>;

export const CheckType = z.enum(["http", "tcp", "icmp"]);
export type CheckType = z.infer<typeof CheckType>;

export const CheckResultStatus = z.enum(["up", "down", "degraded"]);
export type CheckResultStatus = z.infer<typeof CheckResultStatus>;

export const IncidentStatus = z.enum(["investigating", "identified", "monitoring", "resolved"]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const IncidentSource = z.enum(["kuma", "agent", "manual", "maintenance"]);
export type IncidentSource = z.infer<typeof IncidentSource>;

export const MaintenanceStatus = z.enum(["pending", "approved", "active", "completed", "cancelled"]);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatus>;

export const MonitorSourceType = z.enum(["uptime_kuma", "agent", "manual"]);
export type MonitorSourceType = z.infer<typeof MonitorSourceType>;

export const AgentHeartbeatSchema = z.object({
  hostname: z.string().optional(),
  version: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;

export const AgentResultSchema = z.object({
  checkId: z.string().uuid(),
  status: CheckResultStatus,
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  message: z.string().max(2000).optional(),
  checkedAt: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const AgentResultsPayloadSchema = z.object({
  results: z.array(AgentResultSchema).min(1).max(500),
});
export type AgentResultsPayload = z.infer<typeof AgentResultsPayloadSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const CreateTenantSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  brandColor: z.string().max(32).optional(),
});

export const CreateServiceSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  groupName: z.string().max(128).optional(),
  sortOrder: z.number().int().optional(),
  sourceType: MonitorSourceType.optional(),
});

export const CreateKumaInstanceSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(128),
  baseUrl: z.string().url(),
  apiToken: z.string().min(1),
  pollIntervalMs: z.number().int().min(5000).optional(),
  enabled: z.boolean().optional(),
});

export const CreateKumaMappingSchema = z.object({
  kumaInstanceId: z.string().uuid(),
  serviceId: z.string().uuid(),
  kumaMonitorId: z.number().int(),
  kumaMonitorName: z.string().max(256).optional(),
});

export const CreateImapAccountSchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(128),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  folder: z.string().default("INBOX"),
  pollIntervalMs: z.number().int().min(15000).optional(),
  enabled: z.boolean().optional(),
  fromFilter: z.string().max(512).optional(),
  subjectFilter: z.string().max(512).optional(),
});

export const CreateProbeNodeSchema = z.object({
  name: z.string().min(1).max(128),
  location: z.string().min(1).max(64),
  tenantId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const CreateCheckSchema = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  name: z.string().min(1).max(128),
  type: CheckType.default("http"),
  target: z.string().min(1).max(2048),
  intervalMs: z.number().int().min(5000).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  expectedStatus: z.number().int().optional(),
  enabled: z.boolean().optional(),
  nodeIds: z.array(z.string().uuid()).optional(),
});

export const CreateIncidentSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().min(1).max(256),
  message: z.string().max(10000).optional(),
  status: IncidentStatus.optional(),
  source: IncidentSource.optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const CreateMaintenanceSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().min(1).max(256),
  summary: z.string().max(10000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: MaintenanceStatus.optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const ApproveMaintenanceSchema = z.object({
  serviceIds: z.array(z.string().uuid()).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  title: z.string().min(1).max(256).optional(),
  summary: z.string().max(10000).optional(),
});

export function aggregateOverallStatus(statuses: ComponentStatus[]): OverallStatus {
  if (statuses.length === 0) return "operational";
  if (statuses.includes("major_outage")) return "major_outage";
  if (statuses.includes("partial_outage")) return "partial_outage";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("maintenance")) return "maintenance";
  return "operational";
}

export function kumaStatusToComponent(status: number | string): ComponentStatus {
  // Uptime Kuma: 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE
  const n = typeof status === "string" ? Number(status) : status;
  if (n === 1) return "operational";
  if (n === 0) return "major_outage";
  if (n === 3) return "maintenance";
  if (n === 2) return "degraded";
  return "unknown";
}

export function checkResultsToComponent(
  results: Array<{ status: CheckResultStatus }>
): ComponentStatus {
  if (results.length === 0) return "unknown";
  const downs = results.filter((r) => r.status === "down").length;
  const degraded = results.filter((r) => r.status === "degraded").length;
  if (downs === results.length) return "major_outage";
  if (downs > 0) return "partial_outage";
  if (degraded > 0) return "degraded";
  return "operational";
}
