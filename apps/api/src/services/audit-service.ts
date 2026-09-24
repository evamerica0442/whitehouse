import type { AuditAction, AuditOutcome } from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

/**
 * Audit trail for every cross-account action, tied to the admin who initiated it.
 *
 * Writes are best-effort on purpose: a missing audit row is a problem, but
 * failing an otherwise successful provisioning action because the log insert
 * failed would be worse. Failures are reported to the application log at `error`.
 */

export interface AuditInput {
  action: AuditAction;
  outcome?: AuditOutcome;
  actorUserId?: string | null;
  actorEmail?: string | null;
  tenantId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

export interface AuditLogger {
  error: (obj: unknown, msg?: string) => void;
}

export async function writeAuditLog(
  prisma: PrismaClient,
  input: AuditInput,
  logger?: AuditLogger,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        outcome: input.outcome ?? 'SUCCESS',
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        tenantId: input.tenantId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detail: (input.detail ?? undefined) as never,
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null,
      },
    });
  } catch (error) {
    logger?.error({ err: error, action: input.action }, 'failed to write audit log entry');
  }
}
