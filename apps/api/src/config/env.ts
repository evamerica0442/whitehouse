import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CLOUD_PROVIDER_IDS,
  DEFAULT_AWS_REGION,
  DEFAULT_MAGIC_LINK_TTL_MINUTES,
  DEFAULT_SESSION_TTL_HOURS,
} from '@whitehouse/shared';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, and then frozen. Nothing else in the
 * codebase reads `process.env` directly — that is what keeps the Phase 2 move to
 * ECS a configuration change instead of a code change.
 */

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? defaultValue : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
    );

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Public URL of the web app — used for magic-link links and CORS defaults. */
    APP_BASE_URL: z.url().default('http://localhost:5173'),
    /** Public URL of this API. */
    API_BASE_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: csv,

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_URL_UNPOOLED: z.string().optional(),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_COOKIE_NAME: z.string().min(1).default('wh_session'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(DEFAULT_SESSION_TTL_HOURS),
    MAGIC_LINK_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(120)
      .default(DEFAULT_MAGIC_LINK_TTL_MINUTES),
    /**
     * The web app and API run on different hosts on the free tier, which makes
     * the session cookie cross-site: browsers then require SameSite=None +
     * Secure. Local development over http:// needs Lax + insecure.
     */
    SESSION_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    SESSION_COOKIE_SECURE: z.string().optional(),

    EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Whitehouse Cloudguard <onboarding@resend.dev>'),

    CLOUD_PROVIDER: z.enum(CLOUD_PROVIDER_IDS).default('mock'),
    AWS_REGION: z.string().default(DEFAULT_AWS_REGION),
    AWS_MANAGEMENT_ACCOUNT_ID: z
      .string()
      .regex(/^\d{12}$/, 'AWS_MANAGEMENT_ACCOUNT_ID must be 12 digits')
      .optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),

    JOB_DRIVER: z.enum(['pg-boss', 'memory']).default('pg-boss'),
    JOB_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    /** Shared secret for the GitHub Actions scheduler hitting /internal/jobs/run. */
    INTERNAL_CRON_SECRET: z.string().min(16).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.CLOUD_PROVIDER === 'aws' && !value.AWS_MANAGEMENT_ACCOUNT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['AWS_MANAGEMENT_ACCOUNT_ID'],
        message: 'AWS_MANAGEMENT_ACCOUNT_ID is required when CLOUD_PROVIDER=aws',
      });
    }
    if (value.EMAIL_DRIVER === 'resend' && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_DRIVER=resend',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  sessionCookieSecure: boolean;
};

/** Loads the repo-root .env for local dev; real environments set vars directly. */
export function loadDotenvFiles(): void {
  for (const candidate of [
    join(process.cwd(), '.env'),
    join(process.cwd(), '../../.env'),
    join(process.cwd(), '../../../.env'),
  ]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false, quiet: true });
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const value = parsed.data;
  const origin = new URL(value.APP_BASE_URL).origin;
  const cookieSecure =
    value.SESSION_COOKIE_SECURE === undefined
      ? value.NODE_ENV === 'production'
      : booleanFromString(false).parse(value.SESSION_COOKIE_SECURE);

  // Browsers silently drop SameSite=None cookies that are not Secure, which
  // would look like "login succeeded but I am still logged out" in production.
  if (value.SESSION_COOKIE_SAME_SITE === 'none' && !cookieSecure) {
    throw new Error(
      'Invalid environment configuration:\n  - SESSION_COOKIE_SAME_SITE=none requires SESSION_COOKIE_SECURE=true (browsers reject insecure cross-site cookies)',
    );
  }

  return {
    ...value,
    corsOrigins: value.CORS_ORIGINS.length > 0 ? value.CORS_ORIGINS : [origin],
    sessionCookieSecure: cookieSecure,
  };
}
