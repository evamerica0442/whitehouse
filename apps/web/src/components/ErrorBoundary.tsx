import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render-phase errors so a broken screen shows the stack instead of an empty
 * document. React unmounts the whole tree on an uncaught render error, which for an
 * internal admin tool means "the console is blank and nobody knows why" — this at
 * least names the component and the error.
 */
interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the component stack in the console for debugging.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border border-destructive/40 bg-card p-6 text-sm">
          <h1 className="text-base font-semibold">The console hit an unexpected error</h1>
          <p className="mt-2 text-muted-foreground">
            Nothing was changed on any customer account. Reload to try again, and share the detail
            below if it repeats.
          </p>
          <pre className="mt-4 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
          <button
            type="button"
            className="mt-4 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
