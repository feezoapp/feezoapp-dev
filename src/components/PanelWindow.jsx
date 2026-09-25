import { createPortal } from 'react-dom';
import usePanelBounds from '../lib/usePanelBounds';

// Drop-in replacement for the old `<div className="modal-overlay active">`
// wrapper. Keeps the same backdrop (and the same "modal-overlay active"
// class, so existing CSS still applies), but constrains it to the band
// between the fixed header and footer instead of the full viewport, and
// stretches the panel to fill that band edge-to-edge — so it reads as a
// real window sitting between the app chrome, not a small card floating
// over a dimmed gap.
//
// Portals to document.body so it always renders above the current tab's
// content regardless of scrolling/overflow ancestors.
export default function PanelWindow({ onClose, children }) {
  const { top, bottom } = usePanelBounds();

  return createPortal(
    <div
      className="modal-overlay active"
      style={{
        position: 'fixed', top, right: 0, bottom, left: 0,
        display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 0,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>,
    document.body
  );
}
