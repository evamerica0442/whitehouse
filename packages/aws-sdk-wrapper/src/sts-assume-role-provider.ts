import { GetCallerIdentityCommand, AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { CloudProviderError, type CrossAccountRef } from '@whitehouse/shared';

/** Minimal shape needed by SDK v3 clients — avoids a direct @smithy/types dependency. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export interface AssumedSession {
  credentials: AwsCredentials;
  expiration: Date | null;
  assumedRoleArn: string;
  accountId: string;
  callerArn: string;
  userId: string;
}

export interface AssumeRoleOptions {
  /** Overrides the duration of the session (900-43200, capped by the role). */
  durationSeconds?: number;
  /** Skip the cache — used by the wizard's explicit "Test Connection" action. */
  forceRefresh?: boolean;
}

const CACHE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** Maps AWS error names to a stable, user-surfaceable code. */
export function mapStsError(error: unknown): CloudProviderError {
  const name = (error as { name?: string })?.name ?? 'UnknownError';
  const message = (error as { message?: string })?.message ?? 'STS AssumeRole failed';

  switch (name) {
    case 'AccessDenied':
    case 'AccessDeniedException':
      return new CloudProviderError('ASSUME_ROLE_ACCESS_DENIED', message, false);
    case 'ExpiredToken':
    case 'ExpiredTokenException':
      return new CloudProviderError('ASSUME_ROLE_TOKEN_EXPIRED', message, true);
    case 'Throttling':
    case 'ThrottlingException':
      return new CloudProviderError('ASSUME_ROLE_THROTTLED', message, true);
    case 'RegionDisabledException':
      return new CloudProviderError('ASSUME_ROLE_REGION_DISABLED', message, false);
    default:
      return new CloudProviderError(`ASSUME_ROLE_${name.toUpperCase()}`, message, false);
  }
}

/**
 * Assumes customer roles and caches the temporary credentials in memory only.
 *
 * Caching matters: the API runs on a free-tier instance with a 1h role session,
 * and every cross-account call would otherwise pay a round trip. Nothing is
 * written to disk or to the database — a process restart simply re-assumes.
 */
export class StsAssumeRoleProvider {
  private readonly cache = new Map<string, AssumedSession>();

  constructor(
    /** Client using the MSP management account's own identity. */
    private readonly baseClient: STSClient,
    private readonly defaultDurationSeconds = 3600,
  ) {}

  private cacheKey(ref: CrossAccountRef): string {
    return `${ref.roleArn}::${ref.externalId}`;
  }

  async assumeRole(
    ref: CrossAccountRef,
    options: AssumeRoleOptions = {},
  ): Promise<AssumedSession> {
    const key = this.cacheKey(ref);
    const cached = this.cache.get(key);

    if (!options.forceRefresh && cached) {
      const freshUntil = (cached.expiration?.getTime() ?? 0) - CACHE_REFRESH_WINDOW_MS;
      if (freshUntil > Date.now()) {
        return cached;
      }
    }

    try {
      const response = await this.baseClient.send(
        new AssumeRoleCommand({
          RoleArn: ref.roleArn,
          RoleSessionName: `whitehouse-${ref.tenantId.slice(0, 8)}`,
          ExternalId: ref.externalId,
          DurationSeconds: options.durationSeconds ?? this.defaultDurationSeconds,
        }),
      );

      const credentials = response.Credentials;
      if (!credentials?.AccessKeyId || !credentials.SecretAccessKey) {
        throw new CloudProviderError(
          'ASSUME_ROLE_NO_CREDENTIALS',
          'STS returned no credentials for the requested role',
          false,
        );
      }

      // GetCallerIdentity proves the session is usable, not merely issued.
      const identity = await new STSClient({
        region: ref.region,
        credentials: {
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.SecretAccessKey,
          sessionToken: credentials.SessionToken,
        },
      }).send(new GetCallerIdentityCommand({}));

      const session: AssumedSession = {
        credentials: {
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.SecretAccessKey,
          sessionToken: credentials.SessionToken,
          expiration: credentials.Expiration,
        },
        expiration: credentials.Expiration ?? null,
        assumedRoleArn: response.AssumedRoleUser?.Arn ?? ref.roleArn,
        accountId: identity.Account ?? ref.accountId,
        callerArn: identity.Arn ?? '',
        userId: identity.UserId ?? '',
      };

      this.cache.set(key, session);
      return session;
    } catch (error) {
      if (error instanceof CloudProviderError) throw error;
      this.cache.delete(key);
      throw mapStsError(error);
    }
  }

  /** Drops cached credentials, e.g. after a tenant's role ARN changes. */
  invalidate(ref: Pick<CrossAccountRef, 'roleArn' | 'externalId'>): void {
    this.cache.delete(`${ref.roleArn}::${ref.externalId}`);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
