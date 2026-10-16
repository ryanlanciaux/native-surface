import { Github } from 'lucide-react';
import { BRAND, LINKS } from '../brand';
import { Brand } from '../components/Brand';
import './nav.css';

const NAV = [
  { label: 'Docs', href: LINKS.docs },
  { label: 'Playground', href: LINKS.playground },
  { label: 'Showcase', href: LINKS.showcase },
  // Design: "Pricing". native-surface is MIT; the slot points at the repo.
  { label: 'Open source', href: LINKS.github },
  { label: 'Changelog', href: LINKS.changelog },
];

export function Nav() {
  return (
    <header className="nav">
      <Brand />
      <nav className="nav__links" aria-label="Primary">
        {NAV.map((l) => (
          <a key={l.label} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      <div className="nav__actions">
        <a className="nav__icon" href={BRAND.github} aria-label="native-surface on GitHub">
          <Github size={20} strokeWidth={2} />
        </a>
        <a className="nav__cta" href={LINKS.launch}>
          Get started
        </a>
      </div>
    </header>
  );
}
