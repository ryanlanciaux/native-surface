import { Github, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const focusables = () => {
      const panel = panelRef.current;
      const items = panel ? [...panel.querySelectorAll<HTMLElement>('a')] : [];
      return [btnRef.current, ...items].filter((el): el is HTMLElement => !!el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (i <= 0) {
          e.preventDefault();
          list[list.length - 1]!.focus();
        }
      } else if (i === list.length - 1) {
        e.preventDefault();
        list[0]!.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    panelRef.current?.querySelector<HTMLElement>('a')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
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
      </nav>
    </header>
  );
}
