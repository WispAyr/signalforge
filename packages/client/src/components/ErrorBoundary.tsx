import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center justify-center h-full bg-forge-bg">
          <div className="panel-border rounded p-6 max-w-md text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <h2 className="text-lg font-display font-bold text-forge-red tracking-wider mb-2">COMPONENT ERROR</h2>
            <p className="text-xs font-mono text-forge-text-dim mb-3">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 text-xs font-mono bg-forge-cyan/10 text-forge-cyan rounded hover:bg-forge-cyan/20">
              RETRY
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
