import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import Prism from 'prismjs';
// Order matters: tsx builds on jsx + typescript.
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-tsx.js';
import type { Tok } from '../usage';

/**
 * Highlighted, line-numbered source. Read-only by construction: a <pre> of
 * spans — no textarea, no contenteditable, no editor.
 */
export function Code({ text, className }: { text: string; className?: string }): ReactElement {
  const lines = useMemo(() => {
    const html = Prism.highlight(text.trimEnd(), Prism.languages['tsx']!, 'tsx');
    return splitLines(html);
  }, [text]);
  return (
    <pre className={`nsp-code ${className ?? ''}`}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="nsp-code__line">
            <span className="nsp-code__n">{i + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
          </span>
        ))}
      </code>
    </pre>
  );
}

/** Splits highlighted HTML into lines, re-opening token spans that cross a newline. */
function splitLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      out.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (part.startsWith('<span')) open.push(part);
      else if (part === '</span>') open.pop();
      line += part;
    }
  }
  out.push(line);
  return out;
}

/** The Usage tab's generated JSX, one token run per line. */
export function UsageCode({ lines }: { lines: Tok[][] }): ReactElement {
  return (
    <pre className="nsp-code">
      <code>
        {lines.map((line, i) => (
          <span key={i} className="nsp-code__line">
            <span className="nsp-code__n">{i + 1}</span>
            <span>
              {line.map((tok, j) => (
                <span key={j} className={`nsp-tok--${tok.c}`}>
                  {tok.t}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export function Muted({ children }: { children: ReactNode }): ReactElement {
  return <p className="nsp__muted">{children}</p>;
}
