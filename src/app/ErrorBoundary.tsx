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
      <div className="min-h-full grid place-items-center p-6">
        <div className="err">
          <div className="glyph">Signal lost</div>
          <p>
            Something broke mid-session. Anything already recorded was streaming to your disk and
            is recoverable from the library after a reload.
          </p>
          <div className="diag">
            <b>WHAT WE KNOW</b>
            <br />
            ERR · {error.message}
            <br />
            {error.stack?.split('\n').slice(1, 4).join(' · ')}
          </div>
          <div className="flex gap-2.5 mt-1">
            <button type="button" className="btn primary lg" onClick={() => location.reload()}>
              Reload studio
            </button>
            <a
              className="btn lg"
              style={{ textDecoration: 'none' }}
              href={`https://github.com/sahajamit/framecast/issues/new?title=${encodeURIComponent(
                `Crash: ${error.message}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Report issue ↗
            </a>
          </div>
        </div>
      </div>
    );
  }
}
