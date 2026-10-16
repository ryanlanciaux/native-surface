import { ArrowRight } from 'lucide-react';
import { BRAND, LINKS } from '../brand';
import { FILLS, ShaderCanvas } from '../shaders';
import './final-cta.css';

export function FinalCta() {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <ShaderCanvas className="shader-fill" {...FILLS.cta} />
      <h2 className="section-title cta__title" id="cta-title">
        Your app is one link away.
      </h2>
      <p className="cta__body">Point {BRAND.name} at your repo. Get a URL that runs the real thing.</p>
      <div className="cta__buttons">
        <a className="btn-primary" href={LINKS.launch}>
          Launch your app <ArrowRight size={18} strokeWidth={2} />
        </a>
        <a className="btn-ghost" href={LINKS.docs}>
          Read the docs
        </a>
      </div>
    </section>
  );
}
