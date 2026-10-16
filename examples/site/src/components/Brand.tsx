import { Orbit } from 'lucide-react';
import { BRAND } from '../brand';

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <Orbit size={18} strokeWidth={2} />
    </span>
  );
}

export function Brand({ href = '#top' }: { href?: string }) {
  return (
    <a className="brand" href={href} aria-label={`${BRAND.name} home`}>
      <Mark />
      <span>{BRAND.name}</span>
    </a>
  );
}
