import { Component } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import type { Theme } from '../story-types';

interface BoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  resetKey: string;
}

/**
 * Story code runs inside the canvas reconciler, but it throws through the DOM
 * tree — so a broken story shows a message here instead of a blank page.
 */
class PreviewBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): BoundaryState | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[playground] story failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="story-error">
          <strong>Story failed to render</strong>
          <pre>{error.message}</pre>
        </div>
      );
    }
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
}

export function Preview(props: PreviewProps): React.JSX.Element {
  const { surfaceKey, element, width, height, dpr, theme, onAction, title, storyName } = props;

  return (
    <main className="stage">
      <div className="stage-scroll">
        <div className={`device ${theme}`} style={{ width: width + 16, height: height + 16 }}>
          <div className="device-screen" style={{ width, height }}>
            <PreviewBoundary resetKey={surfaceKey}>
              <NativeSurface
                key={surfaceKey}
                width={width}
                height={height}
                dpr={dpr}
                theme={theme}
                onAction={onAction}
                className="surface"
              >
                {element}
              </NativeSurface>
            </PreviewBoundary>
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
