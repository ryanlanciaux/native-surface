import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../story-types';
import { VIEWPORTS } from '../viewports';

export type DprMode = 'auto' | 1 | 2 | 3;

interface ToolbarProps {
  width: number;
  height: number;
  activeViewportId: string | null;
  onViewport: (width: number, height: number) => void;
  onSize: (size: { width?: number; height?: number }) => void;
  dprMode: DprMode;
  onDprMode: (mode: DprMode) => void;
  effectiveDpr: number;
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

const DPR_MODES: DprMode[] = ['auto', 1, 2, 3];

function clampSize(raw: string, current: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return current;
  return Math.min(2000, Math.max(80, value));
}

/** The story id already lives in the URL hash, so "copy link" is just the
 *  current address — shareable deep link included. */
function CopyLink(): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context; fall back to execCommand.
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button type="button" className="chip" title="Copy a shareable link to this story" onClick={() => void copy()}>
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const {
    width,
    height,
    activeViewportId,
    onViewport,
    onSize,
    dprMode,
    onDprMode,
    effectiveDpr,
    theme,
    onTheme,
  } = props;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Native Canvas Playground</span>
        <a className="chip" href="/plane" title="Pan/zoom mock of app routes">
          Plane
        </a>
      </div>

      <div className="tool-group" role="group" aria-label="Viewport preset">
        {VIEWPORTS.map((viewport) => (
          <button
            key={viewport.id}
            type="button"
            className={viewport.id === activeViewportId ? 'chip active' : 'chip'}
            title={`${viewport.width}×${viewport.height}`}
            onClick={() => onViewport(viewport.width, viewport.height)}
          >
            {viewport.label}
          </button>
        ))}
      </div>

      <div className="tool-group sizes">
        <label className="field">
          <span>W</span>
          <input
            type="number"
            value={width}
            min={80}
            max={2000}
            step={1}
            onChange={(event) => onSize({ width: clampSize(event.target.value, width) })}
          />
        </label>
        <label className="field">
          <span>H</span>
          <input
            type="number"
            value={height}
            min={80}
            max={2000}
            step={1}
            onChange={(event) => onSize({ height: clampSize(event.target.value, height) })}
          />
        </label>
      </div>

      <div className="tool-group">
        <label className="field">
          <span>DPR</span>
          <select
            value={String(dprMode)}
            onChange={(event) => {
              const raw = event.target.value;
              onDprMode(raw === 'auto' ? 'auto' : (Number(raw) as DprMode));
            }}
          >
            {DPR_MODES.map((mode) => (
              <option key={String(mode)} value={String(mode)}>
                {mode === 'auto' ? 'Auto' : `${mode}×`}
              </option>
            ))}
          </select>
        </label>
        <span className="badge" title="Device pixel ratio of the canvas backing store">
          {effectiveDpr}× · {Math.round(width * effectiveDpr)}×{Math.round(height * effectiveDpr)}px
        </span>
      </div>

      <div className="tool-group theme" role="group" aria-label="Platform theme">
        {(['ios', 'android'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === theme ? 'chip active' : 'chip'}
            onClick={() => onTheme(option)}
          >
            {option === 'ios' ? 'iOS' : 'Android'}
          </button>
        ))}
      </div>

      <div className="tool-group">
        <CopyLink />
      </div>
    </header>
  );
}
