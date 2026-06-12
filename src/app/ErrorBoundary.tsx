import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Last line of defense: an unhandled render/lifecycle error shows diagnostics
 * instead of a silent white screen. (A renderer-process crash cannot be
 * caught here — that class of bug is covered by e2e/real-flow.spec.ts.)
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-full grid place-items-center p-6 bg-bg text-ink">
        <div className="panel max-w-[560px] p-6 flex flex-col gap-3">
          <h1 className="font-display font-semibold text-lg">framecast hit an unexpected error</h1>
          <pre className="font-mono text-[11px] text-rec whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
            {error.message}
            {'\n'}
            {error.stack?.split('\n').slice(1, 6).join('\n')}
          </pre>
          <p className="text-[13px] text-mute">
            Your recordings are safe: anything already captured is on disk and recoverable from
            the library after a reload.
          </p>
          <div className="flex gap-2">
            <button type="button" className="danger-btn" onClick={() => location.reload()}>
              reload app
            </button>
            <a
              className="hairline-btn"
              href={`https://github.com/sahajamit/framecast/issues/new?title=${encodeURIComponent(
                `Crash: ${error.message}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              report issue ↗
            </a>
          </div>
        </div>
      </div>
    );
  }
}
