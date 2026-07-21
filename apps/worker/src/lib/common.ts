import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";
  return createHash("sha256").update(raw).digest();
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// silence unused import warning for encrypt helpers if needed later
void createCipheriv;
void randomBytes;
