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
        <main className="page">
          <p className="error">Something broke: {this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </main>
      );
    }
    return this.props.children;
  }
}
