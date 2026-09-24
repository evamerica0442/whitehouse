import type { OnboardingTemplate } from '@whitehouse/shared';
import type { Tenant } from '@whitehouse/db';

import type { EmailSender } from './email-sender';

/**
 * Builds the automated-delivery email: the onboarding instructions plus the
 * CloudFormation template as an attachment the customer can upload directly.
 *
 * The body deliberately contains no credentials — only the MSP account ID, the
 * per-tenant ExternalId, and the roles being created.
 */
export interface OnboardingEmailInput {
  tenant: Pick<Tenant, 'customerName' | 'contactName' | 'contactEmail' | 'region'>;
  template: OnboardingTemplate;
  mspAccountId: string;
  senderName: string;
}

export function buildOnboardingEmail(input: OnboardingEmailInput): {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: Buffer }[];
} {
  const greeting = input.tenant.contactName ?? input.tenant.customerName;

  const text = [
    `Hello ${greeting},`,
    '',
    input.template.instructions,
    '',
    `The CloudFormation template is attached (${input.template.stackName}.json).`,
    `If you prefer, request it from ${input.senderName} and we will resend it.`,
    '',
    `MSP management account: ${input.mspAccountId}`,
    `Per-tenant ExternalId: ${input.template.externalId}`,
    `Region: ${input.tenant.region}`,
    '',
    'Thank you,',
    input.senderName,
  ].join('\n');

  const html = [
    `<p>Hello ${escapeHtml(greeting)},</p>`,
    markdownToBasicHtml(input.template.instructions),
    `<p>The CloudFormation template is attached (<code>${escapeHtml(input.template.stackName)}.json</code>).</p>`,
    '<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">',
    row('MSP management account', input.mspAccountId),
    row('Per-tenant ExternalId', input.template.externalId),
    row('Region', input.tenant.region),
    '</table>',
    `<p>Thank you,<br>${escapeHtml(input.senderName)}</p>`,
  ].join('\n');

  return {
    to: input.tenant.contactEmail,
    subject: `Action required: grant Whitehouse Cloudguard access to ${input.tenant.customerName}`,
    html,
    text,
    attachments: [
      {
        filename: `${input.template.stackName}.json`,
        content: Buffer.from(input.template.templateBody, 'utf8'),
      },
    ],
  };
}

function row(label: string, value: string): string {
  return `<tr><td><strong>${escapeHtml(label)}</strong></td><td><code>${escapeHtml(value)}</code></td></tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal markdown rendering for the instructions block. Intentionally tiny:
 * the only markdown that ever reaches here is the string this codebase builds in
 * `buildInstructions`, so a full markdown dependency would be unjustified.
 */
export function markdownToBasicHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      output.push(`<h3>${inline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      output.push(`<h2>${inline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('- ')) {
      if (!inList) {
        output.push('<ul>');
        inList = true;
      }
      output.push(`<li>${inline(trimmed.slice(2))}</li>`);
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      if (!inList) {
        output.push('<ol>');
        inList = true;
      }
      output.push(`<li>${inline(trimmed.replace(/^\d+\.\s/, ''))}</li>`);
      continue;
    }
    if (inList) {
      output.push('</ul>');
      inList = false;
    }
    if (trimmed.length > 0) output.push(`<p>${inline(trimmed)}</p>`);
  }

  if (inList) output.push('</ul>');
  return output.join('\n');
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

export type { EmailSender };
