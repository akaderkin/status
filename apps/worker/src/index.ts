import "dotenv/config";
import { activateMaintenances, pollImapAccounts } from "./imap.js";

const imapInterval = Number(process.env.IMAP_POLL_INTERVAL_MS || 60000);

console.log("Status worker starting...");
console.log(`  IMAP poll every ${imapInterval}ms`);

let imapRunning = false;

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

await tickImap();
setInterval(tickImap, imapInterval);
