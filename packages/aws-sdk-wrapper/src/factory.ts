import { type CloudProvider, type CloudProviderId } from '@whitehouse/shared';

import { AwsCloudProvider } from './aws-provider';
import { MockCloudProvider } from './mock-provider';

export interface AwsCredentialAvailability {
  ok: boolean;
  reason?: string;
}

/**
 * Detects whether the process can sign AWS requests.
 *
 * Covers the three shapes this platform will actually run in: static keys in
 * local `.env`, a named profile, and an ECS/EC2 task or instance role (which
 * needs no explicit credentials at all — the SDK picks it up).
 */
export function checkAwsCredentialAvailability(
  env: NodeJS.ProcessEnv = process.env,
): AwsCredentialAvailability {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return { ok: true };
  if (env.AWS_PROFILE) return { ok: true };
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return { ok: true };
  }
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE) return { ok: true };

  return {
    ok: false,
    reason:
      'No AWS credentials detected (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, AWS_PROFILE, or a task/instance role).',
  };
}

export interface CreateCloudProviderOptions {
  provider: CloudProviderId;
  /**
   * When the AWS driver is selected but credentials are missing, fall back to
   * the mock driver instead of crashing. Defaults to true outside production so
   * a fresh clone can run the console; always refused in production, where
   * silently serving fabricated cost data would be worse than failing.
   */
  allowFallbackToMock?: boolean;
  onFallback?: (reason: string) => void;
  nodeEnv?: string;
}

export function createCloudProvider(options: CreateCloudProviderOptions): CloudProvider {
  if (options.provider === 'mock') {
    return new MockCloudProvider();
  }

  const availability = checkAwsCredentialAvailability();
  if (availability.ok) {
    return new AwsCloudProvider();
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const allowFallback = options.allowFallbackToMock ?? nodeEnv !== 'production';

  if (!allowFallback) {
    throw new Error(
      `CLOUD_PROVIDER=aws was requested but credentials are unavailable. ${availability.reason}`,
    );
  }

  options.onFallback?.(availability.reason ?? 'AWS credentials unavailable');
  return new MockCloudProvider();
}
