import { BRAND, LINKS } from '../brand';
import { Brand } from '../components/Brand';
import './footer.css';

// Design columns: PRODUCT / DEVELOPERS / COMPANY. Entries without a real
// destination are swapped for project links (see brand.ts).
const COLUMNS = [
  {
    heading: 'PRODUCT',
    links: [
      { label: 'Playground', href: LINKS.playground },
      { label: 'Demos', href: LINKS.showcase },
      { label: 'Open source', href: LINKS.github },
    ],
  },
  {
    heading: 'DEVELOPERS',
    links: [
      { label: 'Docs', href: LINKS.docs },
      { label: 'Playground CLI', href: LINKS.cli },
      { label: 'Compat shims', href: LINKS.compat },
      { label: 'GitHub', href: LINKS.github },
    ],
  },
  {
    heading: 'PROJECT',
    links: [
      { label: 'About', href: LINKS.docs },
      { label: 'Releases', href: LINKS.releases },
      { label: 'Issues', href: LINKS.issues },
      { label: 'License', href: `${BRAND.github}/blob/main/LICENSE` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <Brand />
        <p className="footer__tagline">{BRAND.tagline}</p>
        <p className="footer__copy">
          © {BRAND.year} {BRAND.owner}
        </p>
      </div>
      <nav className="footer__cols" aria-label="Footer">
        {COLUMNS.map((col) => (
          <div key={col.heading} className="footer__col">
            <p className="footer__heading">{col.heading}</p>
            {col.links.map((l) => (
              <a key={l.label} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </footer>
  );
}
