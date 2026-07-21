import type { FastifyInstance } from "fastify";
import { ImapFlow } from "imapflow";
import { CreateImapAccountSchema } from "@status/shared";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../lib/auth.js";
import { decrypt, encrypt } from "../lib/crypto.js";

export async function imapRoutes(app: FastifyInstance) {
  app.get("/admin/imap", { preHandler: requireAdmin }, async () => {
    const rows = await prisma.imapAccount.findMany({
      include: { tenant: { select: { slug: true, name: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      ...r,
      passwordEnc: undefined,
      hasPassword: Boolean(r.passwordEnc),
    }));
  });

  app.post("/admin/imap", { preHandler: requireAdmin }, async (request, reply) => {
    const body = CreateImapAccountSchema.parse(request.body);
    const row = await prisma.imapAccount.create({
      data: {
        tenantId: body.tenantId ?? null,
        name: body.name,
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username,
        passwordEnc: encrypt(body.password),
        folder: body.folder,
        pollIntervalMs: body.pollIntervalMs ?? 60000,
        enabled: body.enabled ?? true,
        fromFilter: body.fromFilter,
        subjectFilter: body.subjectFilter,
      },
    });
    return reply.code(201).send({ ...row, passwordEnc: undefined, hasPassword: true });
  });

  app.patch("/admin/imap/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = CreateImapAccountSchema.partial().parse(request.body);
    const data: Record<string, unknown> = {};
    for (const key of [
      "tenantId",
      "name",
      "host",
      "port",
      "secure",
      "username",
      "folder",
      "pollIntervalMs",
      "enabled",
      "fromFilter",
      "subjectFilter",
    ] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.password !== undefined) data.passwordEnc = encrypt(body.password);
    const row = await prisma.imapAccount.update({ where: { id }, data });
    return { ...row, passwordEnc: undefined, hasPassword: true };
  });

  app.delete("/admin/imap/:id", { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.imapAccount.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/admin/imap/:id/test", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await prisma.imapAccount.findUnique({ where: { id } });
    if (!account) return reply.code(404).send({ error: "Not found" });
    try {
      const password = decrypt(account.passwordEnc);
      const client = new ImapFlow({
        host: account.host,
        port: account.port,
        secure: account.secure,
        auth: { user: account.username, pass: password },
        logger: false,
      });
      await client.connect();
      const status = await client.status(account.folder, { messages: true, unseen: true });
      await client.logout();
      return {
        ok: true,
        folder: account.folder,
        messages: status.messages ?? null,
        unseen: status.unseen ?? null,
      };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
