import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort boundary: shows a friendly message instead of a stack trace. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[Nocturne64] Unexpected UI error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal">
        <h1>Something went wrong</h1>
        <p>The interface hit an unexpected problem. Your saved analyses are safe in this browser.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
