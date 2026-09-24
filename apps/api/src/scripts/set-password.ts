/**
 * Sets (or resets) an admin's password.
 *
 * The seed deliberately creates users without passwords, so this is the explicit,
 * auditable step that grants password sign-in:
 *
 *   npm run user:password -w @whitehouse/api -- --email admin@example.com --password '...'
 */
import { getPrismaClient, disconnectPrisma } from '@whitehouse/db';

import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/crypto';
import { loadConfig, loadDotenvFiles } from '../config/env';

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();

  const email = readFlag('email')?.trim().toLowerCase();
  const password = readFlag('password');

  if (!email || !password) {
    throw new Error(
      'Usage: npm run user:password -w @whitehouse/api -- --email <address> --password <password>',
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const prisma = getPrismaClient({ connectionString: config.DATABASE_URL });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error(`No admin with email ${email}. Create one with: npm run user:create -w @whitehouse/api`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });

    // A password change must not leave older sessions alive.
    const revoked = await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    console.log(`Password set for ${email}. Revoked ${revoked.count} existing session(s).`);
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
