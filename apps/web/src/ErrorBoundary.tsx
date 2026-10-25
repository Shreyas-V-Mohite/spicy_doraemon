import { Component, type ReactNode } from "react";

// Keeps one broken component from blanking the whole page.
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="auth-wrap">
          <div className="card auth-card stack">
            <h1>Something went wrong</h1>
            <p className="muted">{this.state.error.message}</p>
            <button onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
