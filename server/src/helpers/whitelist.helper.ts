import fs from 'fs';
import path from 'path';

// Message shown to visitors whose email is not on the whitelist.
export const WHITELIST_MESSAGE =
  "Désolé mais le site n'accepte actuellement que les membres sur liste blanche. Veuillez patienter jusqu'à la sortie officielle de l'application.";

// Plain-text file, one email per line. Blank lines and lines starting with "#" are ignored.
const WHITELIST_PATH = path.join(process.cwd(), '.whitelist');

let cachedEmails: Set<string> = new Set();
let cachedMtimeMs = -1;
let cachedExists = false;

// Re-reads the file only when it has changed on disk, so the manager can edit
// .whitelist without restarting the server.
function refreshCache(): void {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(WHITELIST_PATH);
  } catch {
    cachedExists = false;
    cachedEmails = new Set();
    cachedMtimeMs = -1;
    return;
  }

  cachedExists = true;
  if (stat.mtimeMs === cachedMtimeMs) {
    return;
  }

  const raw = fs.readFileSync(WHITELIST_PATH, 'utf8');
  cachedEmails = new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
  cachedMtimeMs = stat.mtimeMs;
}

// The whitelist is only enforced when the file exists AND contains at least one
// entry — an absent or empty file leaves authentication open (safe default so
// nobody gets locked out by accident).
export function isWhitelistEnforced(): boolean {
  refreshCache();
  return cachedExists && cachedEmails.size > 0;
}

export function isWhitelisted(email: string): boolean {
  if (!isWhitelistEnforced()) {
    return true;
  }
  return cachedEmails.has((email || '').trim().toLowerCase());
}
