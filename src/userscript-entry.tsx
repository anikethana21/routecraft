import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppContext';
import './styles.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-error">
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const shadowRoot = (globalThis as { __ROUTECRAFT_SHADOW_ROOT__?: ShadowRoot }).__ROUTECRAFT_SHADOW_ROOT__;
const container = shadowRoot?.getElementById('root') ?? document.getElementById('root');
if (!container) throw new Error('The userscript root element is missing.');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
