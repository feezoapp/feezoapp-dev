import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Same tab order as BottomNav.jsx.
export const SWIPE_TABS = ['/home', '/students', '/attendance', '/fees', '/enquiry', '/profile'];

function isInsideHScroll(el, root) {
  while (el && el !== root) {
    if (el.classList && el.classList.contains('table-wrap')) return true;
    const style = el.getAttribute && el.getAttribute('style');
    if (style && /overflow-x\s*:\s*(auto|scroll)/i.test(style)) return true;
    el = el.parentElement;
  }
  return false;
}

// Swipe left/right anywhere on the page viewport to move between bottom-nav
// tabs — ported from the HTML app's initSwipeNav. Skips horizontally
// scrollable areas (tables) so it doesn't fight in-page scrolling, and
// requires a decisive horizontal gesture (>55px, mostly horizontal, <600ms)
// so it doesn't fire on ordinary vertical scrolling or taps.
export default function useSwipeNav(viewportRef) {
  const navigate = useNavigate();
  const location = useLocation();
  const touch = useRef({ startX: 0, startY: 0, startTime: 0, tracking: false, claimed: false });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1 || isInsideHScroll(e.target, viewport)) {
        touch.current.tracking = false;
        return;
      }
      touch.current.startX = e.touches[0].clientX;
      touch.current.startY = e.touches[0].clientY;
      touch.current.startTime = Date.now();
      touch.current.tracking = true;
      touch.current.claimed = false;
    };

    // Once a drag is clearly horizontal, take over the gesture so the browser
    // doesn't also interpret it as an overscroll/pull-to-refresh (which was
    // showing its own reload spinner over the header mid-swipe).
    const onTouchMove = (e) => {
      if (!touch.current.tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touch.current.startX;
      const dy = e.touches[0].clientY - touch.current.startY;
      if (!touch.current.claimed && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        touch.current.claimed = true;
      }
      if (touch.current.claimed) e.preventDefault();
    };

    const onTouchEnd = (e) => {
      if (!touch.current.tracking) return;
      touch.current.tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.current.startX;
      const dy = t.clientY - touch.current.startY;
      const dt = Date.now() - touch.current.startTime;

      // Too slow, too short, or too vertical — not a page-swipe gesture.
      if (dt > 600 || Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.3) return;

      const idx = SWIPE_TABS.indexOf(location.pathname);
      if (idx === -1) return;

      if (dx < 0 && idx < SWIPE_TABS.length - 1) navigate(SWIPE_TABS[idx + 1]);
      else if (dx > 0 && idx > 0) navigate(SWIPE_TABS[idx - 1]);
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    // Must be non-passive so we can call preventDefault() once a horizontal
    // swipe is confirmed, to stop the browser's own pull-to-refresh gesture.
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
    };
  }, [viewportRef, navigate, location.pathname]);
}
