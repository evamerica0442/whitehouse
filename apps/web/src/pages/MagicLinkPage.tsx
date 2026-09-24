import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Status = 'working' | 'success' | 'error';

/**
 * Magic-link landing page.
 *
 * The token is exchanged immediately for a real session cookie and then dropped
 * from the URL, so it never lands in browser history or a referrer header. The
 * request runs once (guarded by a ref) because React 19 StrictMode double-invokes
 * effects in development — and a magic link is single-use, so a second exchange
 * would always fail.
 */
export function MagicLinkPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { consumeMagicLink } = useAuth();

  const [status, setStatus] = useState<Status>('working');
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setStatus('error');
      setError('This link is missing its token. Request a new sign-in link.');
      return;
    }

    void (async () => {
      try {
        await consumeMagicLink(token);
        setStatus('success');
        window.history.replaceState({}, '', '/auth/magic-link');
        navigate('/dashboard', { replace: true });
      } catch (caught) {
        setStatus('error');
        setError(caught instanceof Error ? caught.message : 'This sign-in link is no longer valid.');
      }
    })();
  }, [consumeMagicLink, navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Signing you in</CardTitle>
          <CardDescription>Verifying your single-use link.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'working' ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              Exchanging the link for a session…
            </div>
          ) : null}

          {status === 'error' ? (
            <>
              <Alert variant="destructive">
                <AlertTitle>Link not accepted</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Back to sign in
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Links expire and can only be used once.{' '}
                <Link className="underline" to="/login">
                  Request a new one
                </Link>
                .
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
