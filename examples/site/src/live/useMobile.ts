import { useEffect, useState } from 'react';

/** The site's mobile layout breakpoint (sections switch at 899px). */
const QUERY = '(max-width: 899px)';

export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof matchMedia === 'function' && matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
