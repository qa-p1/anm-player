import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Aura UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="glass-panel max-w-md space-y-4 rounded-3xl p-6 text-center" role="alert">
          <h1 className="text-2xl font-bold">Aura hit an unexpected problem</h1>
          <p className="text-sm text-muted-foreground">Reload the page to restart the interface. Your library and downloads are stored by the backend.</p>
          <button type="button" className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground" onClick={() => window.location.reload()}>
            Reload Aura
          </button>
        </div>
      </main>
    );
  }
}
