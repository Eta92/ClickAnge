/**
 * One-off migration from the `.whitelist` file + `isManager` flag to the Role
 * enum stored on every customer document.
 *
 *   npm run migrate:members            # uses ./.whitelist
 *   npm run migrate:members -- --dry   # report only, writes nothing
 *   npm run migrate:members -- path/to/list.txt
 *
 * It does two things:
 *  1. gives every existing customer a role — isManager → MANAGER, an account
 *     that completed email verification → USER, anything else → MEMBER — and
 *     drops the now-unused isManager field;
 *  2. inserts a MEMBER record for every whitelisted email that has no customer
 *     document yet, so those people can still sign in once the file-based
 *     whitelist is gone.
 *
 * Re-running it is safe: existing roles are never downgraded and known emails
 * are skipped.
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { Customer, Role } from '../src/models/customer.model';
import { resolveRole } from '../src/models/role.helper';
import { parseMemberList } from '../src/helpers/member.helper';

const MONGO_URL = process.env.mongoUrl || 'mongodb://localhost:27017';
const DB_NAME = process.env.mongoDb || 'ClickAnge';

interface LegacyCustomer extends Customer {
  isManager?: boolean;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const listArg = args.find((arg) => !arg.startsWith('--'));
  const whitelistPath = path.resolve(listArg || path.join(process.cwd(), '.whitelist'));

  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const customers = client.db(DB_NAME).collection<LegacyCustomer>('customers');

  console.log(`${dryRun ? '[dry run] ' : ''}Migrating customers in ${DB_NAME} at ${MONGO_URL}`);

  // --- 1. role for every existing customer ---
  const existing = await customers.find({}).toArray();
  const byRole: Record<string, number> = {};
  let updated = 0;

  for (const customer of existing) {
    const role = customer.isManager ? Role.MANAGER : resolveRole(customer);
    byRole[role] = (byRole[role] || 0) + 1;

    const alreadyCorrect = customer.role === role && customer.isManager === undefined;
    if (alreadyCorrect) continue;

    updated++;
    if (!dryRun) {
      await customers.updateOne({ email: customer.email }, { $set: { role }, $unset: { isManager: '' } });
    }
  }

  console.log(`  ${existing.length} customer(s) read, ${updated} updated`);
  for (const [role, count] of Object.entries(byRole)) {
    console.log(`    ${role.padEnd(9)} ${count}`);
  }

  // --- 2. whitelisted emails that have no record yet ---
  if (!fs.existsSync(whitelistPath)) {
    console.log(`  No whitelist file at ${whitelistPath} — skipping the import step`);
  } else {
    const { entries, invalid } = parseMemberList(fs.readFileSync(whitelistPath, 'utf8'));
    const known = new Set(existing.map((c) => c.email));
    const missing = entries.filter((entry) => !known.has(entry.email));

    console.log(`  ${entries.length} address(es) in ${path.basename(whitelistPath)}, ${missing.length} not yet in the database`);
    if (invalid.length > 0) {
      console.log(`  ${invalid.length} line(s) ignored: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`);
    }

    if (!dryRun && missing.length > 0) {
      await customers.insertMany(
        missing.map((entry) => ({
          uuid: nanoid(10),
          email: entry.email,
          name: entry.name,
          role: Role.MEMBER,
          emailVerified: false,
          isSubscribed: true,
          resignationCode: nanoid(16),
          createdAt: Date.now(),
        }))
      );
      console.log(`  ${missing.length} member(s) created`);
    }
  }

  await client.close();
  console.log(dryRun ? 'Dry run complete — nothing was written.' : 'Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
