import { loginInputSchema } from '@whitehouse/shared';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { getApiOrigin, isApiConfigured } from '@/lib/api-client';

/**
 * Admin sign-in.
 *
 * Two paths side by side: password, and a magic link sent to the same address. The
 * magic-link path deliberately reports success even for unknown addresses, so the
 * screen cannot be used to enumerate MSP staff accounts.
 */
export function LoginPage() {
  const { user, login, requestMagicLink, isLoading } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [pending, setPending] = useState<'password' | 'magic-link' | null>(null);

  if (!isLoading && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/dashboard'} replace />;
  }

  const onSubmitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFieldError(null);

    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check the email and password fields');
      return;
    }

    setPending('password');
    try {
      await login(parsed.data.email, parsed.data.password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Sign-in failed');
    } finally {
      setPending(null);
    }
  };

  const onRequestMagicLink = async () => {
    setFormError(null);

    const parsed = loginInputSchema.shape.email.safeParse(email);
    if (!parsed.success) {
      setFieldError('Enter your email address first');
      return;
    }

    setPending('magic-link');
    try {
      await requestMagicLink(parsed.data);
      setMagicLinkSent(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not send the sign-in link');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Whitehouse Cloudguard</CardTitle>
          <CardDescription>MSP admin console — staff access only.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {magicLinkSent ? (
            <Alert variant="success">
              <AlertTitle>Check your inbox</AlertTitle>
              <AlertDescription>
                If that address belongs to an active admin, a single-use sign-in link is on its way.
              </AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={onSubmitPassword}>
            <Field label="Email" htmlFor="email" error={fieldError}>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@msp.example"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
              />
            </Field>

            <Button type="submit" className="w-full" isLoading={pending === 'password'}>
              Sign in
            </Button>
          </form>

          <div className="relative text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">or</span>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onRequestMagicLink}
            isLoading={pending === 'magic-link'}
          >
            Email me a sign-in link
          </Button>

          <p className="text-xs text-muted-foreground">
            Accounts are created by a super admin. If you do not have one yet, run the
            <code className="mx-1 rounded bg-muted px-1 py-0.5">user:create</code>
            script on the API.
          </p>

          {/* Which API this page talks to is the first thing to check when sign-in
              fails, so it is visible instead of buried in the network tab. */}
          <p className="border-t border-border pt-3 text-center text-xs text-muted-foreground">
            API endpoint: <code className="text-foreground">{getApiOrigin()}</code>
            {isApiConfigured() ? null : <span> (same origin — proxied to the API in dev)</span>}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
