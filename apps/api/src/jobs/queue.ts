import { JOB_NAMES, type JobName } from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';
import { PgBoss } from 'pg-boss';

import { AppError } from '../lib/errors';
import type { AppLogger } from '../services/onboarding-service';

/**
 * Provider-agnostic job queue.
 *
 * Every action that touches a customer account goes through here, so long-running
 * work is retryable and never depends on an HTTP request staying alive.
 *
 * The default driver is pg-boss (a Postgres-backed queue) rather than BullMQ,
 * because BullMQ requires Redis and the free-tier Redis options cannot be trusted
 * with provisioning jobs: Render's free Key Value is in-memory and loses the
 * queue on restart, and Upstash bills per command while BullMQ polls constantly.
 * pg-boss reuses the Neon database we are already paying for, so the queue adds
 * no infrastructure. Swapping in BullMQ or SQS later means implementing one more
 * `JobQueue`.
 */

export interface JobPayloadMap {
  'tenant.verify-connection': { tenantId: string; requestedByUserId: string | null };
  'tenant.apply-guardrails': {
    tenantId: string;
    guardrailKeys: string[];
    scpPolicyIds: string[];
    requestedByUserId: string | null;
  };
  'tenant.send-onboarding-email': {
    tenantId: string;
    recipient: string;
    requestedByUserId: string | null;
  };
  'cost.refresh-snapshot': { tenantId: string | null; requestedByUserId: string | null };
  'guardrail.run-checks': { tenantId: string | null; guardrailKeys: string[] };
  'catalog.deploy-template': {
    tenantId: string;
    templateKey: string;
    version: string | null;
    stackName: string;
    parameters: Record<string, string>;
    requestedByUserId: string | null;
  };
}

export type JobHandler<K extends JobName> = (
  payload: JobPayloadMap[K],
  meta: { jobId: string; attempts: number },
) => Promise<unknown>;

export type JobHandlerMap = { [K in JobName]?: JobHandler<K> };

export interface EnqueueOptions {
  /** Tenant the work belongs to, mirrored onto the JobRun row for the UI. */
  tenantId?: string | null;
  /** Admin who triggered it, so the job list can attribute the work. */
  requestedByUserId?: string | null;
  delaySeconds?: number;
}

export interface JobQueue {
  readonly driver: 'pg-boss' | 'memory';
  enqueue<K extends JobName>(
    name: K,
    payload: JobPayloadMap[K],
    options?: EnqueueOptions,
  ): Promise<string>;
  start(handlers: JobHandlerMap): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_RETRY_LIMIT = 3;

export interface QueueDependencies {
  prisma: PrismaClient;
  logger: AppLogger;
  concurrency?: number;
}

/** Mirrors queue lifecycle into `job_runs` so retries are visible in the UI. */
async function createRun(
  prisma: PrismaClient,
  name: JobName,
  options: EnqueueOptions | undefined,
): Promise<string> {
  const run = await prisma.jobRun.create({
    data: {
      jobName: name,
      tenantId: options?.tenantId ?? null,
      createdByUserId: options?.requestedByUserId ?? null,
      maxAttempts: DEFAULT_RETRY_LIMIT,
      status: 'QUEUED',
    },
  });
  return run.id;
}

async function markRun(
  prisma: PrismaClient,
  queueJobId: string,
  data: {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    result?: unknown;
    error?: string | null;
    attempts?: number;
  },
  logger: AppLogger,
): Promise<void> {
  try {
    await prisma.jobRun.updateMany({
      where: { queueJobId },
      data: {
        status: data.status,
        ...(data.result === undefined ? {} : { result: data.result as never }),
        ...(data.error === undefined ? {} : { error: data.error }),
        ...(data.attempts === undefined ? {} : { attempts: data.attempts }),
        ...(data.status === 'RUNNING' ? { startedAt: new Date() } : {}),
        ...(data.status === 'SUCCEEDED' || data.status === 'FAILED'
          ? { finishedAt: new Date() }
          : {}),
      },
    });
  } catch (error) {
    logger.warn({ err: error, queueJobId }, 'failed to update job run status');
  }
}

export class PgBossJobQueue implements JobQueue {
  readonly driver = 'pg-boss' as const;

  private readonly boss: PgBoss;

  constructor(
    private readonly deps: QueueDependencies,
    connectionString: string,
  ) {
    this.boss = new PgBoss({
      connectionString,
      // Bounds how many jobs this process pulls at once; retries and backoff are
      // configured per send, below.
      max: deps.concurrency ?? 2,
    });
  }

  async start(handlers: JobHandlerMap): Promise<void> {
    await this.boss.start();

    for (const name of JOB_NAMES) {
      try {
        await this.boss.createQueue(name);
      } catch {
        // pg-boss's createQueue is not idempotent; an existing queue is fine.
      }
    }

    for (const name of JOB_NAMES) {
      const handler = handlers[name];
      if (!handler) continue;

      /** Shape we rely on at runtime; narrower than pg-boss's option-dependent union. */
      interface ReceivedJob {
        id: string;
        data: unknown;
        retryCount?: number;
      }

      // pg-boss types the handler callback from the options generic, which cannot be
      // satisfied without importing its internal types. The runtime contract with
      // batchSize: 1 is one job per invocation — and both shapes are handled below
      // so a future batchSize change cannot silently drop jobs.
      const onJobs = async (received: unknown): Promise<void> => {
        const batch = (Array.isArray(received) ? received : [received]) as ReceivedJob[];

        for (const job of batch) {
          const attempts = job.retryCount ?? 0;
          await markRun(
            this.deps.prisma,
            job.id,
            { status: 'RUNNING', attempts },
            this.deps.logger,
          );

          try {
            const result = await handler(job.data as never, { jobId: job.id, attempts });
            await markRun(
              this.deps.prisma,
              job.id,
              { status: 'SUCCEEDED', result: result ?? null },
              this.deps.logger,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await markRun(
              this.deps.prisma,
              job.id,
              { status: 'FAILED', error: message, attempts },
              this.deps.logger,
            );
            // Rethrow so pg-boss applies its retry and backoff policy.
            throw error;
          }
        }
      };

      await this.boss.work(name, { batchSize: 1 }, onJobs as never);
    }

    this.deps.logger.info({ driver: this.driver }, 'job worker started');
  }

  async enqueue<K extends JobName>(
    name: K,
    payload: JobPayloadMap[K],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const runId = await createRun(this.deps.prisma, name, options);

    const queueJobId = await this.boss.send(name, payload as object, {
      retryLimit: DEFAULT_RETRY_LIMIT,
      retryBackoff: true,
      ...(options.delaySeconds ? { startAfter: options.delaySeconds } : {}),
    });

    if (!queueJobId) {
      throw AppError.internal(`Failed to enqueue job ${name}`);
    }

    await this.deps.prisma.jobRun.update({
      where: { id: runId },
      data: { queueJobId, payload: payload as never },
    });

    return queueJobId;
  }

  async stop(): Promise<void> {
    // pg-boss drains in-flight jobs by default; we let it.
    await this.boss.stop();
  }
}

type LooseHandlerMap = Partial<
  Record<JobName, (payload: never, meta: { jobId: string; attempts: number }) => Promise<unknown>>
>;

/**
 * In-process driver for tests and for a laptop with no database.
 *
 * Parity with pg-boss where it matters: the same JobRun mirroring and the same
 * three attempts with linear backoff. What it does NOT give you is durability
 * across restarts — which is precisely why it is not the production default.
 */
export class MemoryJobQueue implements JobQueue {
  readonly driver = 'memory' as const;

  private handlers: LooseHandlerMap = {};
  private readonly timers = new Set<NodeJS.Timeout>();
  private counter = 0;

  constructor(private readonly deps: QueueDependencies) {}

  async start(handlers: JobHandlerMap): Promise<void> {
    this.handlers = handlers as unknown as LooseHandlerMap;
    this.deps.logger.warn(
      { driver: this.driver },
      'job worker running in memory — queued work is lost if the process restarts',
    );
  }

  async enqueue<K extends JobName>(
    name: K,
    payload: JobPayloadMap[K],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const queueJobId = `memory-${(this.counter += 1)}`;
    const runId = await createRun(this.deps.prisma, name, options);

    await this.deps.prisma.jobRun.update({
      where: { id: runId },
      data: { queueJobId, payload: payload as never },
    });

    const timer = setTimeout(
      () => {
        void this.dispatch(name, payload, queueJobId);
      },
      (options.delaySeconds ?? 0) * 1000,
    );
    timer.unref?.();
    this.timers.add(timer);

    return queueJobId;
  }

  private async dispatch<K extends JobName>(
    name: K,
    payload: JobPayloadMap[K],
    queueJobId: string,
  ): Promise<void> {
    const handler = this.handlers[name];
    if (!handler) {
      this.deps.logger.warn({ job: name }, 'no handler registered for job');
      return;
    }

    for (let attempt = 1; attempt <= DEFAULT_RETRY_LIMIT; attempt += 1) {
      await markRun(
        this.deps.prisma,
        queueJobId,
        { status: 'RUNNING', attempts: attempt - 1 },
        this.deps.logger,
      );

      try {
        const result = await handler(payload as never, { jobId: queueJobId, attempts: attempt - 1 });
        await markRun(
          this.deps.prisma,
          queueJobId,
          { status: 'SUCCEEDED', result: result ?? null, attempts: attempt },
          this.deps.logger,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt === DEFAULT_RETRY_LIMIT) {
          await markRun(
            this.deps.prisma,
            queueJobId,
            { status: 'FAILED', error: message, attempts: attempt },
            this.deps.logger,
          );
          return;
        }

        this.deps.logger.warn({ err: message, job: name, attempt }, 'job attempt failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

export function createJobQueue(
  config: { JOB_DRIVER: 'pg-boss' | 'memory'; JOB_CONCURRENCY: number; DATABASE_URL: string },
  deps: QueueDependencies,
): JobQueue {
  if (config.JOB_DRIVER === 'memory') {
    return new MemoryJobQueue(deps);
  }
  return new PgBossJobQueue({ ...deps, concurrency: config.JOB_CONCURRENCY }, config.DATABASE_URL);
}


