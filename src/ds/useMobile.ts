import { useEffect, useState } from 'react';

// CSS media queries cannot reference custom properties; keep this aligned with components.css.
const mobileQuery = '(max-width: 759px)';
/** Live viewport state shared by drawer and its topbar trigger. */
export function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return mobile;
}
