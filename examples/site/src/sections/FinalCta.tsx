import { Github } from 'lucide-react';
import { EXTERNAL, LINKS } from '../brand';
import './final-cta.css';

export function FinalCta() {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <h2 className="section-title cta__title" id="cta-title">
        Try today
      </h2>
      <p className="cta__body">Add the Vite preset and run your React Native components in any React web app.</p>
      <div className="cta__buttons">
        <a className="btn-primary" href={LINKS.github} {...EXTERNAL}>
          <Github size={18} strokeWidth={2} aria-hidden="true" /> View on GitHub
        </a>
        <a className="btn-ghost" href={LINKS.docs} {...EXTERNAL}>
          Read the docs
        </a>
      </div>
    </section>
  );
}
