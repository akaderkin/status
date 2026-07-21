import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decrypt, prisma, sha256 } from "./lib/common.js";

function parseTurkishDate(dateStr: string, timeStr: string): Date | null {
  const cleaned = dateStr.trim().replace(/[./]/g, "-");
  let y: number, m: number, d: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    [y, m, d] = cleaned.split("-").map(Number);
  } else {
    const parts = cleaned.split("-").map(Number);
    if (parts.length !== 3) return null;
    if (parts[2]! > 31) {
      // DD-MM-YYYY
      d = parts[0]!;
      m = parts[1]!;
      y = parts[2]!;
    } else if (parts[0]! > 31) {
      y = parts[0]!;
      m = parts[1]!;
      d = parts[2]!;
    } else {
      d = parts[0]!;
      m = parts[1]!;
      y = parts[2]! < 100 ? 2000 + parts[2]! : parts[2]!;
    }
  }
  const [hh, mm] = timeStr.split(":").map(Number);
  // Assume Europe/Istanbul wall time as UTC+3 approximation for MVP
  const utc = Date.UTC(y, m - 1, d, hh! - 3, mm!);
  return new Date(utc);
}

export function parseMaintenanceWindow(text: string): {
  startsAt: Date;
  endsAt: Date;
} {
  // 22/07/2026 02:00 - 22/07/2026 06:00
  const full = text.match(
    /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}).{0,40}?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/i
  );
  if (full) {
    const start = parseTurkishDate(full[1]!, full[2]!);
    const end = parseTurkishDate(full[3]!, full[4]!);
    if (start && end && end > start) return { startsAt: start, endsAt: end };
  }

  // same day: 22.07.2026 02:00 - 06:00
  const sameDay = text.match(
    /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/i
  );
  if (sameDay) {
    const start = parseTurkishDate(sameDay[1]!, sameDay[2]!);
    const end = parseTurkishDate(sameDay[1]!, sameDay[3]!);
    if (start && end) {
      if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
      return { startsAt: start, endsAt: end };
    }
  }

  // Fallback: now + 4h so mail is not dropped
  return {
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  };
}

function looksLikeMaintenance(subject: string, body: string, from: string): boolean {
  const hay = `${subject}\n${body}\n${from}`.toLowerCase();
  const keywords = [
    "bakım",
    "bakim",
    "maintenance",
    "çalışma",
    "calisma",
    "kesinti",
    "planlı",
    "planli",
    "türk telekom",
    "turk telekom",
    "ttnet",
  ];
  return keywords.some((k) => hay.includes(k));
}

export async function pollImapAccounts() {
  const accounts = await prisma.imapAccount.findMany({ where: { enabled: true } });

  for (const account of accounts) {
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
      const lock = await client.getMailboxLock(account.folder);
      try {
        const sinceUid = (account.lastUid ?? 0) + 1;
        let maxUid = account.lastUid ?? 0;

        for await (const msg of client.fetch(`${sinceUid}:*`, {
          uid: true,
          source: true,
          envelope: true,
        })) {
          if (msg.uid > maxUid) maxUid = msg.uid;
          if (!msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || "(no subject)";
          const from =
            parsed.from?.text ||
            msg.envelope?.from?.map((f) => f.address).join(", ") ||
            "";
          const htmlBody =
            typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "";
          const body = parsed.text || htmlBody || "";

          if (account.fromFilter && !from.toLowerCase().includes(account.fromFilter.toLowerCase())) {
            continue;
          }
          if (
            account.subjectFilter &&
            !subject.toLowerCase().includes(account.subjectFilter.toLowerCase())
          ) {
            continue;
          }
          if (!looksLikeMaintenance(subject, body, from)) continue;

          const messageId = parsed.messageId || `uid-${account.id}-${msg.uid}`;
          const rawHash = sha256(`${messageId}|${subject}|${body.slice(0, 2000)}`);

          const existing = await prisma.maintenance.findFirst({
            where: {
              OR: [{ emailMessageId: messageId }, { emailRawHash: rawHash }],
            },
          });
          if (existing) continue;

          const window = parseMaintenanceWindow(`${subject}\n${body}`);
          let tenantId = account.tenantId;
          if (!tenantId) {
            const first = await prisma.tenant.findFirst({ orderBy: { slug: "asc" } });
            if (!first) continue;
            tenantId = first.id;
          }

          await prisma.maintenance.create({
            data: {
              tenantId,
              imapAccountId: account.id,
              title: subject.slice(0, 256),
              summary: body.slice(0, 8000),
              status: "pending",
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              emailMessageId: messageId.slice(0, 512),
              emailSubject: subject.slice(0, 512),
              emailFrom: from.slice(0, 512),
              emailRawHash: rawHash,
              emailBody: body.slice(0, 20000),
            },
          });
          console.log(`[imap] New maintenance from mail: ${subject}`);
        }

        await prisma.imapAccount.update({
          where: { id: account.id },
          data: {
            lastPolledAt: new Date(),
            lastUid: maxUid || account.lastUid,
            lastError: null,
          },
        });
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[imap] ${account.name}: ${message}`);
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: { lastError: message.slice(0, 2000), lastPolledAt: new Date() },
      });
    }
  }
}

export async function activateMaintenances() {
  const now = new Date();
  const toActivate = await prisma.maintenance.findMany({
    where: {
      status: "approved",
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    include: { services: true },
  });

  for (const m of toActivate) {
    await prisma.maintenance.update({
      where: { id: m.id },
      data: { status: "active" },
    });
    for (const link of m.services) {
      await prisma.service.update({
        where: { id: link.serviceId },
        data: { status: "maintenance" },
      });
    }
  }

  const toComplete = await prisma.maintenance.findMany({
    where: {
      status: { in: ["approved", "active"] },
      endsAt: { lt: now },
    },
    include: { services: true },
  });

  for (const m of toComplete) {
    await prisma.maintenance.update({
      where: { id: m.id },
      data: { status: "completed" },
    });
    for (const link of m.services) {
      // leave status; next agent poll will refresh
      const svc = await prisma.service.findUnique({ where: { id: link.serviceId } });
      if (svc?.status === "maintenance") {
        await prisma.service.update({
          where: { id: link.serviceId },
          data: { status: "operational" },
        });
      }
    }
  }
}
