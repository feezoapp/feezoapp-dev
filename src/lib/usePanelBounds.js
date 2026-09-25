import { useEffect, useState } from 'react';

// Measures the app's fixed header/footer so overlay panels (Apply Leave,
// Leave list, Assign/Edit Task, View Task) can sit exactly in the band
// between them — like their own small window — instead of covering the
// whole screen including the header and bottom nav.
//
// It looks for elements marked with data-app-header / data-app-footer.
// TopBar already carries data-app-header. Add data-app-footer to the
// root element of your bottom nav component (one attribute, no logic
// change) so this can find it too. If either is missing, it falls back
// to a sensible fixed offset so panels still look right.
const FALLBACK_TOP = 62;
const FALLBACK_BOTTOM = 60;

export default function usePanelBounds() {
  const [bounds, setBounds] = useState({ top: FALLBACK_TOP, bottom: FALLBACK_BOTTOM });

  useEffect(() => {
    const header = document.querySelector('[data-app-header]');
    const footer = document.querySelector('[data-app-footer]');

    const measure = () => {
      const top = header ? Math.round(header.getBoundingClientRect().bottom) : FALLBACK_TOP;
      const bottom = footer ? Math.round(window.innerHeight - footer.getBoundingClientRect().top) : FALLBACK_BOTTOM;
      setBounds({ top, bottom });
    };

    measure();
    window.addEventListener('resize', measure);

    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(measure);
      if (header) ro.observe(header);
      if (footer) ro.observe(footer);
    }

    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  return bounds;
}
