import { BRAND } from '../brand';

/** The X (formerly Twitter) logo glyph. */
export function XLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Ryan's X account: logo + handle, opens in a new tab. */
export function XLink({ className = 'x-link', onClick }: { className?: string; onClick?: () => void }) {
  return (
    <a
      className={className}
      href={BRAND.x.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${BRAND.x.handle} on X`}
      onClick={onClick}
    >
      <XLogo />
      <span className="x-link__handle">{BRAND.x.handle}</span>
    </a>
  );
}
