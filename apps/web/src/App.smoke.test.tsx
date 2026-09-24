import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';

/**
 * Render smoke test.
 *
 * A blank screen in the browser means an exception during module evaluation or the
 * first render — React unmounts the tree and nothing paints. Rendering the real
 * component tree (all of App's imports, the providers, the router) turns that class
 * of failure into a readable stack trace in CI instead of a white page.
 */
function render(initialPath: string): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the sign-in screen at /login', () => {
    const html = render('/login');

    expect(html).toContain('Whitehouse Cloudguard');
    expect(html).toContain('Sign in');
    expect(html).toContain('Email me a sign-in link');
  });

  it('shows the API endpoint so a misconfiguration is visible on screen', () => {
    const html = render('/login');

    expect(html).toContain('API endpoint:');
  });

  it('renders a loader (not a blank page) while the session is unknown', () => {
    const html = render('/');

    // Without a resolved session the guard must render something — a loader or the
    // sign-in screen — rather than an empty document.
    expect(html.length).toBeGreaterThan(0);
    expect(html).toMatch(/Checking your session|Sign in|Loading/);
  });
});
