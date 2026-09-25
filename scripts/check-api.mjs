#!/usr/bin/env node
/**
 * Answers "why can't the web app reach the API?" in one command.
 *
 * Checks the two independent things that have to line up, and which produce the same
 * useless browser error when they don't:
 *   1. reachability — is something answering at the configured API URL?
 *   2. CORS — will the browser let the web origin read that response, with credentials?
 *
 * Read-only: it calls /healthz and an unauthenticated endpoint, nothing else.
 *
 * Run with: npm run check:api
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(process.cwd(), '.env'), quiet: true });

const strip = (value) => (value ?? '').replace(/\/+$/, '');
const configuredApiUrl = strip(process.env.VITE_API_BASE_URL);
const apiBaseUrl = strip(process.env.API_BASE_URL) || 'http://localhost:4000';
const webOrigin = strip(process.env.APP_BASE_URL) || 'http://localhost:5173';

// With VITE_API_BASE_URL empty the browser calls its own origin and the dev server
// proxies /api to API_BASE_URL, so that is what has to be reachable from this machine.
const target = configuredApiUrl || apiBaseUrl;
const viaProxy = configuredApiUrl.length === 0;

console.log('Configuration');
console.log('  VITE_API_BASE_URL :', configuredApiUrl || '(empty — app uses this page\'s origin)');
console.log('  API_BASE_URL      :', process.env.API_BASE_URL || '(unset — defaults to http://localhost:4000)');
console.log('  Web origin        :', webOrigin);
console.log('  CORS_ORIGINS (API):', process.env.CORS_ORIGINS || '(unset)');
console.log(
  '  Probing           :',
  target,
  viaProxy ? '(dev-proxy target — same-origin requests are forwarded here)' : '(browser calls this directly)',
);
console.log('');

let failures = 0;

// ---- 1. Reachability -------------------------------------------------------
const startedAt = Date.now();
let healthResponse;
try {
  healthResponse = await fetch(`${target}/healthz`, { signal: AbortSignal.timeout(65_000) });
} catch (error) {
  failures += 1;
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  console.log(`✗ /healthz not reachable after ${Date.now() - startedAt} ms`);
  console.log(
    timedOut
      ? '  Timed out after 65s. On Render\'s free tier the service sleeps after 15 minutes idle and'
      : '  Connection refused or DNS failure.',
  );
  if (timedOut) console.log('  takes about a minute to wake — try again, or open the API URL in a browser.');
  else if (viaProxy) {
    console.log('  Nothing is listening there, so start the API:  npm run dev   (or npm run dev:api)');
    console.log('  Alternatively set VITE_API_BASE_URL to a deployed API and restart the dev server.');
  } else {
    console.log(`  Check the service is up, and that ${configuredApiUrl} is the right URL.`);
  }
  process.exitCode = 1;
}

if (healthResponse) {
  const body = await healthResponse.text();
  console.log(`✓ /healthz responded ${healthResponse.status} in ${Date.now() - startedAt} ms`);
  console.log(`  ${body.slice(0, 160)}`);

  // ---- 2. Database readiness ----------------------------------------------
  // /readyz is the only endpoint that reports whether the API can reach Postgres.
  // A database that is unreachable makes every data route (login included) fail.
  try {
    const readyResponse = await fetch(`${target}/readyz`, { signal: AbortSignal.timeout(30_000) });
    const readyBody = (await readyResponse.text()).slice(0, 400);
    if (readyResponse.status === 200) {
      console.log('✓ /readyz reports the database is reachable');
    } else {
      failures += 1;
      console.log(`✗ /readyz reports the database is NOT reachable (${readyResponse.status})`);
      console.log(`  ${readyBody}`);
      console.log('');
      console.log('  Sign-in and every other data route will fail with a generic 500 until this');
      console.log('  is fixed. Check the database host: is the project still there, is the compute');
      console.log('  suspended (Neon free tier suspends when CU-hours run out), and does the');
      console.log('  password match the one in the API host\'s environment?');
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`✗ /readyz probe failed: ${error.name}`);
  }

  // ---- 3. CORS -------------------------------------------------------------
  const corsResponse = await fetch(`${target}/api/v1/auth/me`, {
    headers: { origin: webOrigin },
    signal: AbortSignal.timeout(20_000),
  });

  const allowOrigin = corsResponse.headers.get('access-control-allow-origin');
  const allowCredentials = corsResponse.headers.get('access-control-allow-credentials');
  const expectedStatus = corsResponse.status; // 401 is the healthy answer here

  console.log(`✓ /api/v1/auth/me responded ${expectedStatus} (401 is expected without a session)`);

  if (allowOrigin === webOrigin) {
    console.log(`✓ CORS allows ${webOrigin}`);
  } else {
    failures += 1;
    console.log(`✗ CORS does NOT allow ${webOrigin}`);
    console.log(`  access-control-allow-origin: ${allowOrigin ?? '(absent)'}`);
    console.log('  The browser will block the response even though the request arrives.');
    console.log('');
    console.log(`  Fix: set CORS_ORIGINS on the API to include ${webOrigin}`);
    console.log('  (comma-separated, exact origin — scheme + host + port, no trailing slash).');
    if (viaProxy) {
      console.log('  A local API gets this from the root .env; a deployed API needs it in its');
      console.log('  host\'s environment variables, then a restart/redeploy.');
    }
    process.exitCode = 1;
  }

  if (allowCredentials === 'true') {
    console.log('✓ CORS allows credentials (the session cookie can be sent)');
  } else {
    failures += 1;
    console.log('✗ CORS does not allow credentials — the session cookie will be dropped');
    console.log('  access-control-allow-credentials:', allowCredentials ?? '(absent)');
    process.exitCode = 1;
  }

  const webIsSecure = webOrigin.startsWith('https://');
  const apiIsSecure = target.startsWith('https://');
  if (!viaProxy && webIsSecure && !apiIsSecure) {
    console.log('');
    console.log('⚠ Mixed content: an https page cannot call an http API. The browser blocks it');
    console.log('  before it leaves the machine — use https for both.');
  }
}

console.log('');
if (failures === 0) {
  console.log('API is reachable and CORS permits the browser to read it.');
} else {
  console.log(`${failures} problem(s) found above.`);
}
