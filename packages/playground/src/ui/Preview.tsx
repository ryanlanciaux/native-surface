import { Component, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import type { Theme } from '../story-types';

function StoryErrorPanel({ error }: { error: Error }): ReactElement {
  // The import-audit stub's Proxy throws this exact phrase on use — a missing
  // bridge is a known gap, not a broken story, so it gets its own treatment
  // (and a pointer at the Audit panel).
  const notBridged = /has no web bridge yet/.test(error.message);
  return (
    <div className={notBridged ? 'story-error not-bridged' : 'story-error'} data-not-bridged={notBridged || undefined}>
      <strong>{notBridged ? 'Not bridged yet' : 'Story failed to render'}</strong>
      <pre>{error.message}</pre>
      {notBridged ? (
        <p className="story-error-hint">
          This story uses a native module without a web bridge in native-surface yet. The Audit panel lists every
          import stubbed this session.
        </p>
      ) : null}
    </div>
  );
}

interface InnerBoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

/**
 * Lives INSIDE the canvas tree: the engine's reconciler reports uncaught
 * errors through React's root handlers (never rethrowing into the DOM tree),
 * so story errors must be caught by a boundary that is itself a canvas-tree
 * component. It renders nothing on error and hands the error to the DOM
 * chrome, which swaps the canvas for the error panel.
 */
class InnerStoryBoundary extends Component<InnerBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[playground] story failed to render', error, info.componentStack);
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

interface DomBoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface DomBoundaryState {
  error: Error | null;
  resetKey: string;
}

/** Catches DOM-side failures (the surface itself, engine load) the same way. */
class PreviewBoundary extends Component<DomBoundaryProps, DomBoundaryState> {
  state: DomBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: DomBoundaryProps, state: DomBoundaryState): DomBoundaryState | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<DomBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[playground] preview failed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) return <StoryErrorPanel error={error} />;
    return this.props.children;
  }
}

interface PreviewProps {
  surfaceKey: string;
  element: ReactElement;
  width: number;
  height: number;
  dpr: number;
  theme: Theme;
  onAction: (name: string, payload?: unknown) => void;
  title: string;
  storyName: string;
  /** Inset between device chrome and canvas, CSS px. */
  padding?: number;
}

export function Preview(props: PreviewProps): React.JSX.Element {
  const { surfaceKey, element, width, height, dpr, theme, onAction, title, storyName, padding = 16 } = props;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  // Keyed by surfaceKey so switching stories (or toggling theme) retries.
  const [innerError, setInnerError] = useState<{ key: string; error: Error } | null>(null);
  const activeError = innerError && innerError.key === surfaceKey ? innerError.error : null;

  return (
    <main className="stage">
      <div className="stage-scroll">
        <div className={`device ${theme}`} style={{ width: width + 16, height: height + 16 }}>
          <div className="device-screen" style={{ width, height, padding }}>
            {activeError ? (
              <StoryErrorPanel error={activeError} />
            ) : (
              <PreviewBoundary resetKey={surfaceKey}>
                <NativeSurface
                  key={surfaceKey}
                  width={innerWidth}
                  height={innerHeight}
                  dpr={dpr}
                  theme={theme}
                  onAction={onAction}
                  className="surface"
                >
                  <InnerStoryBoundary
                    key={surfaceKey}
                    onError={(error) => setInnerError({ key: surfaceKey, error })}
                  >
                    {element}
                  </InnerStoryBoundary>
                </NativeSurface>
              </PreviewBoundary>
            )}
          </div>
        </div>
        <p className="stage-caption">
          <span className="stage-title">{title}</span>
          <span className="stage-sep">/</span>
          <span>{storyName}</span>
          <span className="stage-dim">
            {width}×{height} · {theme}
          </span>
        </p>
      </div>
    </main>
  );
}
