import { Github } from 'lucide-react';
import { BRAND, EXTERNAL, LINKS } from '../brand';
import { Brand } from '../components/Brand';
import { XLink } from '../components/XLink';
import './footer.css';

// One row, real destinations only.
const FOOTER_LINKS = [
  { label: 'GitHub', href: LINKS.github, external: true },
  { label: 'Docs', href: LINKS.docs, external: true },
  { label: 'Surfaces', href: LINKS.surfaces, external: false },
];

export function Footer() {
  return (
    <footer className="footer">
      <Brand />
      <nav className="footer__links" aria-label="Footer">
        {FOOTER_LINKS.map((l) => (
          <a key={l.label} href={l.href} {...(l.external ? EXTERNAL : {})}>
            {l.label === 'GitHub' && <Github size={15} strokeWidth={2} aria-hidden="true" />}
            {l.label}
          </a>
        ))}
      </nav>
      <XLink className="x-link footer__x" />
      <p className="footer__copy">
        © {BRAND.year} {BRAND.owner}
      </p>
    </footer>
  );
}
