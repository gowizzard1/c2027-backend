/**
 * Backfill access tokens for volunteers registered before the toolkit-link feature.
 *
 * Any volunteer with a null accessToken gets a fresh unguessable token so the admin
 * "Copy toolkit link" button works for them.
 *
 * Run locally:
 *   cd backend
 *   npx ts-node prisma/backfill-access-tokens.ts
 *
 * Run against production (Railway) — use the PUBLIC db url:
 *   DATABASE_URL="postgresql://...proxy.rlwy.net:PORT/railway" npx ts-node prisma/backfill-access-tokens.ts
 *
 * Idempotent: only touches volunteers that don't already have a token.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generateAccessToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

async function main() {
  const missing = await prisma.volunteer.findMany({
    where: { accessToken: null },
    select: { id: true, name: true, role: true },
  });

  if (missing.length === 0) {
    console.log('All volunteers already have an access token. Nothing to do.');
    return;
  }

  console.log(`Backfilling access tokens for ${missing.length} volunteer(s)...`);
  let done = 0;
  for (const v of missing) {
    // Retry on the rare unique-collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.volunteer.update({ where: { id: v.id }, data: { accessToken: generateAccessToken() } });
        done++;
        console.log(`  ✓ ${v.name} (${v.role})`);
        break;
      } catch (e: any) {
        if (attempt === 4) console.log(`  ✗ ${v.name}: ${e.message}`);
      }
    }
  }
  console.log(`Done. ${done}/${missing.length} updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
