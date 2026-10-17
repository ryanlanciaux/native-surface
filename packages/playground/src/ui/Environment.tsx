import type { ReactElement } from 'react';
import type { ColorScheme } from '../story-types';
import type { Viewport } from '../viewports';
import { ChevronsIcon } from './icons';
import { Segmented } from './Segmented';

export type DprMode = 'auto' | 1 | 2 | 3;
const DPR_MODES: DprMode[] = ['auto', 1, 2, 3];
const CUSTOM = 'custom';

interface EnvironmentProps {
  devices: Viewport[];
  device: Viewport;
  onDevice: (device: Viewport) => void;
  /** Offer a free-form W × H (the Custom device). */
  allowCustom: boolean;
  onCustomSize: (size: { width?: number; height?: number }) => void;
  scheme: ColorScheme;
  onScheme: (scheme: ColorScheme) => void;
  /** DPR picker (standalone tool); omitted in embeds. */
  dpr?: { mode: DprMode; effective: number; onMode: (mode: DprMode) => void };
}

function clampSize(raw: string, current: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return current;
  return Math.min(2000, Math.max(80, value));
}

/** Device (true logical points, insets, radius), light/dark, and the canvas pixel ratio. */
export function Environment(props: EnvironmentProps): ReactElement {
  const { devices, device, onDevice, allowCustom, onCustomSize, scheme, onScheme, dpr } = props;
  const custom = device.id === CUSTOM;
  return (
    <div className="nsp__env">
      <p className="nsp__heading">ENVIRONMENT</p>
      <label className="nsp__select" data-label={device.label}>
        <select
          aria-label="Device"
          value={device.id}
          onChange={(event) => {
            const next = devices.find((d) => d.id === event.target.value);
            if (next) onDevice(next);
            else onCustomSize({});
          }}
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
          {(allowCustom || custom) && <option value={CUSTOM}>Custom</option>}
        </select>
        <span className="nsp__select-dim">{`${device.width}×${device.height}`}</span>
        <ChevronsIcon />
      </label>
      {custom && (
        <div className="nsp__sizes">
          <label className="nsp__field">
            <span>W</span>
            <input
              type="number"
              className="nsp-prop__input"
              value={device.width}
              min={80}
              max={2000}
              onChange={(event) => onCustomSize({ width: clampSize(event.target.value, device.width) })}
            />
          </label>
          <label className="nsp__field">
            <span>H</span>
            <input
              type="number"
              className="nsp-prop__input"
              value={device.height}
              min={80}
              max={2000}
              onChange={(event) => onCustomSize({ height: clampSize(event.target.value, device.height) })}
            />
          </label>
        </div>
      )}
      {dpr && (
        <label className="nsp__select" data-label={`Pixel ratio · ${dpr.mode === 'auto' ? 'auto' : `${dpr.mode}×`}`}>
          <select
            aria-label="Pixel ratio"
            value={String(dpr.mode)}
            onChange={(event) => {
              const raw = event.target.value;
              dpr.onMode(raw === 'auto' ? 'auto' : (Number(raw) as DprMode));
            }}
          >
            {DPR_MODES.map((mode) => (
              <option key={String(mode)} value={String(mode)}>
                {mode === 'auto' ? 'Auto' : `${mode}×`}
              </option>
            ))}
          </select>
          <span className="nsp__select-dim" title="Canvas backing store">
            {`${dpr.effective}× · ${Math.round(device.width * dpr.effective)}×${Math.round(device.height * dpr.effective)}px`}
          </span>
          <ChevronsIcon />
        </label>
      )}
      <Segmented className="nsp__theme" value={scheme} options={['light', 'dark'] as const} onChange={onScheme} label="Theme" />
    </div>
  );
}
