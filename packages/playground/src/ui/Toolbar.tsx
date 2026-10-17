import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { LockIcon } from './icons';
import { Segmented } from './Segmented';

export type View = 'preview' | 'code';

interface ToolbarProps {
  view: View;
  onView: (view: View) => void;
  /** Address shown in the URL pill. */
  url: string;
  /** Copy a shareable link to the story on click (the selection lives in the hash). */
  copyable: boolean;
  /** Laid-out size of what's on stage, pt. */
  size: { width: number; height: number } | null;
  /** Extra link at the right (the standalone tool's design plane). */
  planeHref?: string;
}

/** Window bar: traffic lights, Preview | Code, the story's address, size, LIVE · WASM. */
export function Toolbar(props: ToolbarProps): ReactElement {
  const { view, onView, url, copyable, size, planeHref } = props;
  return (
    <div className="nsp__bar">
      <span className="nsp__lights" aria-hidden="true">
        <i style={{ background: '#FF5F57CC' }} />
        <i style={{ background: '#FEBC2ECC' }} />
        <i style={{ background: '#28C840CC' }} />
      </span>
      <Segmented
        className="nsp__view"
        value={view}
        options={['preview', 'code'] as const}
        labels={{ preview: 'Preview', code: 'Code' }}
        onChange={onView}
        label="View"
      />
      {copyable ? <CopyUrl url={url} /> : <span className="nsp__url"><LockIcon size={12} /><span>{url}</span></span>}
      <span className="nsp__spacer" />
      {planeHref && (
        <a className="nsp__size nsp__link" href={planeHref} title="Pan/zoom mock of app routes">
          Plane
        </a>
      )}
      <span className="nsp__size" title="Laid-out size (pt)">
        {size ? `${size.width} × ${size.height}` : ' '}
      </span>
      <span className="nsp__live">
        <span className="nsp__live-dot" />
        LIVE · WASM
      </span>
    </div>
  );
}

function CopyUrl({ url }: { url: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (): Promise<void> => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Clipboard API needs a secure context; fall back to execCommand.
      const input = document.createElement('input');
      input.value = href;
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
    <button type="button" className="nsp__url" title="Copy a shareable link to this story" onClick={() => void copy()}>
      <LockIcon size={12} />
      <span>{copied ? 'Link copied' : url}</span>
    </button>
  );
}
