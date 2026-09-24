/**
 * Creates an MSP admin user.
 *
 *   npm run user:create -w @whitehouse/api -- --email eng@example.com --name "Ada" --role ENGINEER
 *
 * Created without a password on purpose: the account signs in by magic link, or an
 * operator sets a password explicitly with `user:password`.
 */
import { ADMIN_ROLES, type AdminRole } from '@whitehouse/shared';
import { disconnectPrisma, getPrismaClient } from '@whitehouse/db';

import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/crypto';
import { loadConfig, loadDotenvFiles } from '../config/env';

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseRole(value: string | undefined): AdminRole {
  const role = (value ?? 'ENGINEER').toUpperCase();
  if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
    throw new Error(`--role must be one of: ${ADMIN_ROLES.join(', ')}`);
  }
  return role as AdminRole;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();

  const email = readFlag('email')?.trim().toLowerCase();
  const name = readFlag('name');
  const role = parseRole(readFlag('role'));
  const password = readFlag('password');

  if (!email || !name) {
    throw new Error(
      'Usage: npm run user:create -w @whitehouse/api -- --email <address> --name "<full name>" [--role ENGINEER] [--password <password>]',
    );
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const prisma = getPrismaClient({ connectionString: config.DATABASE_URL });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error(`An admin with email ${email} already exists.`);
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: password ? await hashPassword(password) : null,
      },
    });

    console.log(
      `Created ${user.role} ${user.email}. ${
        password ? 'Password sign-in is enabled.' : 'Sign-in is by magic link (no password set).'
      }`,
    );
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
