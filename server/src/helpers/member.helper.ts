export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MemberEntry {
  email: string;
  name?: string;
}

export interface ParsedMemberList {
  entries: Array<MemberEntry>;
  /** Lines that carried text but no usable email address. */
  invalid: Array<string>;
}

/**
 * Parses the text a manager pastes into the bulk-add box. One entry per line
 * (commas and semicolons also separate), in either of the two shapes the
 * existing address lists use:
 *
 *   jane@example.com
 *   Jane Doe <jane@example.com>
 *
 * Blank lines and `#` comments are ignored so a `.whitelist` file can be
 * pasted as-is.
 */
export function parseMemberList(raw: string): ParsedMemberList {
  const entries: Array<MemberEntry> = [];
  const invalid: Array<string> = [];
  const seen = new Set<string>();

  const lines = (raw || '')
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  for (const line of lines) {
    const angled = line.match(/^(.*)<([^<>]+)>$/);
    const email = normalizeEmail(angled ? angled[2] : line);
    const name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : undefined;

    if (!EMAIL_REGEX.test(email)) {
      invalid.push(line);
      continue;
    }
    if (seen.has(email)) continue;

    seen.add(email);
    entries.push({ email, name: name || undefined });
  }

  return { entries, invalid };
}

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}
