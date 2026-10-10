// Shared, presentation-only helpers for the Performance section
// (leaderboard, programs, add program, award points, student details).
// No business logic lives here — icons, tokens and tiny layout components only.

export const PF_ICONS = {
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  funnel: <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  plus: <path d="M5 12h14M12 5v14" />,
  calendarCheck: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  award: <><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></>,
  scale: <><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
  arrowUp: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  clipboardList: <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
  layers: <><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  trash: <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  save: <><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" /></>,
  maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>,
  userRound: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
};

export function PfIcon({ name, size = 16, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {PF_ICONS[name]}
    </svg>
  );
}

export const PF_CSS = `
.pf-btn,.pf-card,.pf-head,.pf-chart,.pf-iconbtn{transition:transform .12s ease,border-color .15s ease,background-color .15s ease,box-shadow .15s ease}
.pf-btn:active:not(:disabled),.pf-chart:active,.pf-iconbtn:active:not(:disabled){transform:scale(.96)}
.pf-btn:disabled{opacity:.55;cursor:not-allowed}
.pf-card:active{transform:scale(.995)}
@media (hover:hover){.pf-card:hover{border-color:#B9C7E6;box-shadow:0 2px 8px rgba(16,32,64,.07)}}
.pf-btn:focus-visible,.pf-card:focus-visible,.pf-head:focus-visible,.pf-chart:focus-visible,.pf-iconbtn:focus-visible,.pf-field:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.pf-field{transition:border-color .15s ease,box-shadow .15s ease}
.pf-field:focus{border-color:#5B7CC4 !important;box-shadow:0 0 0 3px rgba(91,124,196,.18);outline:none}
@keyframes pf-fade{from{opacity:0}to{opacity:1}}
@keyframes pf-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pf-overlay{animation:pf-fade .15s ease}
.pf-popup{animation:pf-pop .16s ease}
@media (prefers-reduced-motion:reduce){.pf-btn,.pf-card,.pf-head,.pf-chart,.pf-iconbtn,.pf-overlay,.pf-popup{animation:none !important;transition:none !important}}
`;

// ── tokens ──
export const pfCardStyle = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
  boxShadow: '0 1px 2px rgba(16,32,64,.05)', boxSizing: 'border-box', maxWidth: '100%',
};
export const pfCtl = { width: '100%', minWidth: 0, height: 40, fontSize: 14, padding: '0 10px', boxSizing: 'border-box', background: '#fff' };
export const pfActionBtn = { height: 36, padding: '0 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
export const pfOutlineBtn = { ...pfActionBtn, background: '#fff', color: '#1A336A', border: '1px solid var(--border)' };
export const pfPrimaryBtn = { ...pfActionBtn, background: '#1A336A', color: '#fff', border: 'none' };
export const pfFilterBtn = { flex: '1 1 45%', minWidth: 0, height: 40, padding: '0 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#1A336A', border: '1px solid var(--border)', boxSizing: 'border-box' };
export const pfRadioRow = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, minHeight: 42, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', margin: '2px 0', color: '#333' };
export const pfRadioInput = { width: 18, height: 18, accentColor: '#1A336A', flexShrink: 0, cursor: 'pointer' };
export const pfIconBtn = { width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: '#fff', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 };
export const pfDangerIconBtn = { ...pfIconBtn, border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C' };

const PF_TONES = {
  neutral: { bg: 'var(--card2, #F1F5FB)', color: '#475569', border: 'var(--border, #DCE4F2)' },
  info:    { bg: 'rgba(91,124,196,.10)', color: '#1A336A', border: 'rgba(91,124,196,.22)' },
  success: { bg: '#ECFDF5', color: '#15803D', border: '#BBF7D0' },
  danger:  { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
};

export function PfBadge({ icon, tone = 'neutral', children }) {
  const t = PF_TONES[tone] || PF_TONES.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 7px', boxSizing: 'border-box', fontSize: 11, fontWeight: 600, lineHeight: 1, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 6, whiteSpace: 'nowrap', maxWidth: '100%', flexShrink: 0 }}>
      {icon && <PfIcon name={icon} size={12} stroke={2.2} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </span>
  );
}

export function PfTruncLabel({ children }) {
  return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{children}</span>;
}

// Small form label with optional icon (matches the Class Log / Enquiry sheets).
export function PfLabel({ htmlFor, icon, children }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 5 }}>
      {icon && <PfIcon name={icon} size={13} />}
      <span>{children}</span>
    </label>
  );
}

// White card with a titled header row, used to group form fields / content.
export function PfSection({ icon, title, right, children, style }) {
  return (
    <div style={{ ...pfCardStyle, padding: 12, marginBottom: 10, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#1A336A' }}>
            {icon && <PfIcon name={icon} size={15} />} {title}
          </span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Round back button used on the in-page detail screens.
export function PfBackButton({ onClick, label = 'Back' }) {
  return (
    <button type="button" className="pf-iconbtn" onClick={onClick} aria-label={label} title={label}
      style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', border: '1px solid var(--border)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
      <PfIcon name="arrowLeft" size={18} />
    </button>
  );
}

// Page-level title row: icon + title on the left, actions on the right.
export function PfPageHeader({ icon, title, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
        {icon && <PfIcon name={icon} size={20} />}
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>{title}</span>
      </div>
      {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

// Student / program identity header for detail screens (back + name + secondary line).
export function PfStudentHeader({ onBack, name, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <PfBackButton onClick={onBack} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#182238', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{name}</div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 1, overflowWrap: 'anywhere' }}>{sub}</div>
      </div>
    </div>
  );
}

// Compact segmented control. items: [{ key, label, icon }]
export function PfSegmented({ items, value, onChange, ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--card2, #F1F5FB)', border: '1px solid var(--border)', borderRadius: 12, boxSizing: 'border-box', width: '100%' }}>
      {items.map(t => {
        const on = value === t.key;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} className="pf-btn" onClick={() => onChange(t.key)}
            style={{ flex: '1 1 0', minWidth: 0, height: 36, padding: '0 6px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, whiteSpace: 'nowrap', background: on ? '#1A336A' : 'transparent', color: on ? '#fff' : '#475569' }}>
            {t.icon && <PfIcon name={t.icon} size={14} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PfEmpty({ icon = 'clipboardList', children }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '24px 20px', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ color: '#9DB2DD' }}><PfIcon name={icon} size={28} /></span>
      <div>{children}</div>
    </div>
  );
}
