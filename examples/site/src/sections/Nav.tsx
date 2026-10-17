import { Github, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { BRAND, LINKS } from '../brand';
import { Brand } from '../components/Brand';
import './nav.css';

const NAV = [
  { label: 'Docs', href: LINKS.docs },
  { label: 'Playground', href: LINKS.playground },
  { label: 'Demos', href: LINKS.showcase },
  // Design: "Pricing". native-surface is MIT; the slot points at the repo.
  { label: 'Open source', href: LINKS.github },
  { label: 'Releases', href: LINKS.releases },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const inDisclosure = (n: Node | null) =>
      !!n && (panelRef.current?.contains(n) || btnRef.current?.contains(n));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (inDisclosure(e.target as Node)) return;
      setOpen(false);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (inDisclosure(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocusIn);
    panelRef.current?.querySelector<HTMLElement>('a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
        <button
          ref={btnRef}
          type="button"
          className="nav__menu-btn"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
        </button>
      </div>
      <nav
        ref={panelRef}
        id={menuId}
        className="nav__menu"
        aria-label="Site"
        hidden={!open}
      >
        {NAV.map((l) => (
          <a key={l.label} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a className="nav__menu-cta" href={LINKS.launch} onClick={() => setOpen(false)}>
          Get started
        </a>
      </nav>
    </header>
  );
}
