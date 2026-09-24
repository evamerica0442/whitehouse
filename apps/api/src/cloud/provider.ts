import type { CloudProvider } from '@whitehouse/shared';
import { createCloudProvider } from '@whitehouse/aws-sdk-wrapper';

import type { AppConfig } from '../config/env';

export interface CloudLogger {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

/**
 * Builds the active CloudProvider from configuration.
 *
 * `CLOUD_PROVIDER=aws` with no reachable credentials degrades to the mock driver
 * outside production (with a loud warning) so a fresh clone and CI both work;
 * in production it throws rather than quietly serving invented cost figures.
 */
export function createCloudProviderFromConfig(
  config: AppConfig,
  logger: CloudLogger,
): CloudProvider {
  const provider = createCloudProvider({
    provider: config.CLOUD_PROVIDER,
    nodeEnv: config.NODE_ENV,
    onFallback: (reason) =>
      logger.warn(
        { reason },
        'CLOUD_PROVIDER=aws requested without credentials — falling back to the mock provider',
      ),
  });

  logger.info({ provider: provider.id }, 'cloud provider initialised');
  return provider;
}
