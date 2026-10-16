import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { BRAND } from '../brand';

/** "$ npx native-surface playground" chip; click copies the command. */
export function CopyCommand({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BRAND.cli);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command stays selectable */
    }
  };
  return (
    <button type="button" className={`command ${className}`} onClick={copy} aria-label={`Copy command: ${BRAND.cli}`}>
      <code>$ {BRAND.cli}</code>
      {copied ? <Check size={16} color="#C6F432" /> : <Copy size={16} />}
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
