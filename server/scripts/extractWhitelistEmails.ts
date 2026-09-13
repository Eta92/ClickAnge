import fs from 'fs';
import path from 'path';

const SOURCE_FILE = path.join(__dirname, '..', '..', 'whitelist_souce.txt');
const OUTPUT_FILE = path.join(__dirname, '..', '..', 'whitelist_out.txt');

function extractEmails(sourcePath: string): string[] {
  const content = fs.readFileSync(sourcePath, 'utf-8');
  const matches = content.matchAll(/<([^<>]+)>/g);
  const emails: string[] = [];
  for (const match of matches) {
    emails.push(match[1].trim());
  }
  return emails;
}

function main() {
  const emails = extractEmails(SOURCE_FILE);
  fs.writeFileSync(OUTPUT_FILE, emails.join('\n') + '\n', 'utf-8');
  console.log(`Extracted ${emails.length} emails to ${OUTPUT_FILE}`);
}

main();
