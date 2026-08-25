import { useMemo } from 'react';
import Prism from 'prismjs';
// Order matters: tsx builds on jsx + typescript.
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-tsx.js';

/** Syntax-highlighted source view for an island. Loaded lazily so Prism and
 *  the raw source strings stay out of the first-paint chunk. */
export function CodePanel({ file, source }: { file: string; source: string }) {
  const html = useMemo(
    () => Prism.highlight(source.trimEnd(), Prism.languages['tsx']!, 'tsx'),
    [source]
  );
  return (
    <div className="code-panel">
      <div className="code-panel__head">
        <span className="code-panel__file">{file}</span>
        <span className="code-panel__lang">tsx</span>
      </div>
      <pre className="code-panel__pre">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

export default CodePanel;
