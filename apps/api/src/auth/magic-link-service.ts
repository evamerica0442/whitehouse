import type { PrismaClient } from '@whitehouse/db';

import type { AppConfig } from '../config/env';
import type { EmailMessage } from '../email/email-sender';
import { generateOpaqueToken, hashToken } from './crypto';

/**
 * Magic-link sign-in for admin staff.
 *
 * Two rules that matter:
 *   1. Asking for a link for an unknown address returns the same response as a
 *      known one (no account enumeration).
 *   2. A link is single-use: consuming it stamps `consumedAt`, so a mail
 *      scanner that pre-fetches the URL cannot burn the link for the real user.
 */

export interface MagicLinkRequestResult {
  created: boolean;
  token: string | null;
  recipient: string | null;
  expiresAt: Date | null;
}

export async function createMagicLink(
  prisma: PrismaClient,
  config: AppConfig,
  email: string,
): Promise<MagicLinkRequestResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    return { created: false, token: null, recipient: null, expiresAt: null };
  }

  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + config.MAGIC_LINK_TTL_MINUTES * 60 * 1000);

  // Invalidate outstanding links so only the newest one works.
  await prisma.magicLink.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.magicLink.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token, config.SESSION_SECRET),
      expiresAt,
    },
  });

  return { created: true, token, recipient: user.email, expiresAt };
}

export interface ConsumedMagicLink {
  userId: string;
}

export async function consumeMagicLink(
  prisma: PrismaClient,
  config: AppConfig,
  token: string,
): Promise<ConsumedMagicLink | null> {
  const record = await prisma.magicLink.findUnique({
    where: { tokenHash: hashToken(token, config.SESSION_SECRET) },
  });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  // updateMany with consumedAt: null makes the consume atomic under concurrency.
  const consumed = await prisma.magicLink.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  if (consumed.count !== 1) return null;

  return { userId: record.userId };
}

export function buildMagicLinkUrl(config: AppConfig, token: string): string {
  const base = config.APP_BASE_URL.replace(/\/$/, '');
  return `${base}/auth/magic-link?token=${encodeURIComponent(token)}`;
}

export function buildMagicLinkEmail(params: {
  config: AppConfig;
  token: string;
  recipientName: string;
  expiresMinutes: number;
}): EmailMessage {
  const url = buildMagicLinkUrl(params.config, params.token);

  return {
    to: '',
    subject: 'Your Whitehouse Cloudguard sign-in link',
    text: [
      `Hi ${params.recipientName},`,
      '',
      'Use the link below to sign in to the Whitehouse Cloudguard console:',
      url,
      '',
      `This link expires in ${params.expiresMinutes} minutes and can only be used once.`,
      'If you did not request it, you can ignore this email.',
    ].join('\n'),
    html: [
      `<p>Hi ${params.recipientName},</p>`,
      '<p>Use the link below to sign in to the Whitehouse Cloudguard console:</p>',
      `<p><a href="${url}">Sign in to Whitehouse Cloudguard</a></p>`,
      `<p>This link expires in ${params.expiresMinutes} minutes and can only be used once.<br>`,
      'If you did not request it, you can ignore this email.</p>',
    ].join('\n'),
  };
}
