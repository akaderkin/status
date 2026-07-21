import "dotenv/config";
import { pollKumaInstances } from "./kuma.js";
import { activateMaintenances, pollImapAccounts } from "./imap.js";

const kumaInterval = Number(process.env.KUMA_POLL_INTERVAL_MS || 30000);
const imapInterval = Number(process.env.IMAP_POLL_INTERVAL_MS || 60000);

console.log("Status worker starting...");
console.log(`  Kuma poll every ${kumaInterval}ms`);
console.log(`  IMAP poll every ${imapInterval}ms`);

let kumaRunning = false;
let imapRunning = false;

async function tickKuma() {
  if (kumaRunning) return;
  kumaRunning = true;
  try {
    await pollKumaInstances();
  } catch (e) {
    console.error("[kuma] tick error", e);
  } finally {
    kumaRunning = false;
  }
}

async function tickImap() {
  if (imapRunning) return;
  imapRunning = true;
  try {
    await pollImapAccounts();
    await activateMaintenances();
  } catch (e) {
    console.error("[imap] tick error", e);
  } finally {
    imapRunning = false;
  }
}

await tickKuma();
await tickImap();
setInterval(tickKuma, kumaInterval);
setInterval(tickImap, imapInterval);
