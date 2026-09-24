import { describe, expect, it } from 'vitest';

import { ConsoleEmailSender, type EmailSender } from './email-sender';

/**
 * The console driver is the default, and with it the log *is* the delivery channel:
 * an operator copies the magic-link URL out of it. A previous "preview" truncation
 * cut the token off mid-URL, which silently made magic-link sign-in impossible
 * without Resend configured.
 */
describe('ConsoleEmailSender', () => {
  it('logs the full message body so a magic link stays copyable', async () => {
    const logged: unknown[] = [];
    const sender: EmailSender = new ConsoleEmailSender({
      info: (payload) => {
        logged.push(payload);
      },
    });

    const url = `http://localhost:5173/auth/magic-link?token=${'t'.repeat(96)}`;

    const result = await sender.send({
      to: 'admin@example.com',
      subject: 'Your sign-in link',
      html: `<p><a href="${url}">Sign in</a></p>`,
      text: `Hi there,\n\nUse the link below:\n${url}\n`,
    });

    expect(result.ok).toBe(true);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).toContain(url);
  });

  it('reports itself as the console driver so /healthz is unambiguous', () => {
    const sender = new ConsoleEmailSender({ info: () => undefined });
    expect(sender.driver).toBe('console');
  });

  it('never fails a delivery, so a failed send cannot block onboarding', async () => {
    const sender = new ConsoleEmailSender({ info: () => undefined });
    const result = await sender.send({
      to: 'someone@example.com',
      subject: 'x',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });
});
