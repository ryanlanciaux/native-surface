import { useMemo } from 'react';
import Prism from 'prismjs';
// Order matters: tsx builds on jsx + typescript.
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-tsx.js';

/** Highlighted, line-numbered source (the app's real files, imported ?raw). */
export function Code({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => {
    const html = Prism.highlight(text.trimEnd(), Prism.languages['tsx']!, 'tsx');
    return splitLines(html);
  }, [text]);
  return (
    <pre className={`pg-code ${className ?? ''}`}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="pg-code__line">
            <span className="pg-code__n">{i + 1}</span>
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
