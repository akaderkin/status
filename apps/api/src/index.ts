import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { registerAuth } from "./lib/auth.js";
import { authRoutes } from "./routes/auth.js";
import { tenantRoutes } from "./routes/tenants.js";
import { serviceRoutes } from "./routes/services.js";
import { imapRoutes } from "./routes/imap.js";
import { nodeRoutes } from "./routes/nodes.js";
import { checkRoutes } from "./routes/checks.js";
import { incidentRoutes } from "./routes/incidents.js";
import { maintenanceRoutes } from "./routes/maintenances.js";
import { agentRoutes } from "./routes/agent.js";
import { publicRoutes } from "./routes/public.js";
import { dashboardRoutes } from "./routes/dashboard.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(",") ?? true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition"],
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET || "dev-secret-change-me",
  sign: { expiresIn: "7d" },
});

await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
  nameSpace: "status-rl-",
  allowList: (req) => {
    const url = req.url.split("?")[0] || "";
    if (url === "/admin/auth/login") return false;
    if (url.startsWith("/admin/")) return true;
    if (
      url.startsWith("/v1/agent/download/") ||
      url === "/v1/agent/install.sh" ||
      url === "/v1/agent/systemd.service" ||
      url === "/v1/agent/meta"
    ) {
      return true;
    }
    return false;
  },
});

registerAuth(app);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "Validation error", details: err.flatten() });
  }
  const prismaErr = err as { code?: string; meta?: { cause?: string }; message?: string; statusCode?: number };
  if (prismaErr.code === "P2025") {
    return reply.code(404).send({ error: "Kayıt bulunamadı" });
  }
  if (prismaErr.code === "P2003") {
    return reply.code(409).send({
      error: "Bağlı kayıtlar var; önce ilişkili monitor / incident / bakımları sil",
    });
  }
  if (prismaErr.code === "P2002") {
    return reply.code(409).send({ error: "Bu kayıt zaten var (unique)" });
  }
  app.log.error(err);
  const status = prismaErr.statusCode ?? 500;
  return reply.code(status).send({ error: prismaErr.message || "Internal error" });
});

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(tenantRoutes);
await app.register(serviceRoutes);
await app.register(imapRoutes);
await app.register(nodeRoutes);
await app.register(checkRoutes);
await app.register(incidentRoutes);
await app.register(maintenanceRoutes);
await app.register(agentRoutes);
await app.register(publicRoutes);
await app.register(dashboardRoutes);

const host = process.env.API_HOST || "0.0.0.0";
// DigitalOcean / Heroku inject PORT (often 8080)
const port = Number(process.env.PORT || process.env.API_PORT || 3000);

await app.listen({ host, port });
console.log(`API listening on http://${host}:${port}`);
