import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { usePlan } from '../context/PlanContext';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { parseBatchKey } from '../lib/batchKey';
import { exportGenericPdf, exportGenericXlsx } from '../lib/exporters';
import LimitGatedButton from '../components/LimitGatedButton';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayStr = () => new Date().toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${(h % 12) || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

function calcDuration(inTime, outTime) {
  if (!inTime || !outTime) return '';
  const [ih, im] = inTime.split(':').map(Number);
  const [oh, om] = outTime.split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const emptyForm = { date: todayStr(), sport: '', batch: '', inTime: '', outTime: '', note: '' };

// Converts a 24h "HH:MM" value into { h12, min, period } for the custom picker
function to12(t) {
  if (!t) return { h12: '', min: '', period: 'AM' };
  const [h, m] = t.split(':').map(Number);
  return { h12: String((h % 12) || 12), min: pad(m), period: h >= 12 ? 'PM' : 'AM' };
}
// Converts { h12, min, period } back into a 24h "HH:MM" string
function to24(h12, min, period) {
  if (!h12 || min === '') return '';
  let h = parseInt(h12, 10) % 12;
  if (period === 'PM') h += 12;
  return `${pad(h)}:${pad(parseInt(min, 10))}`;
}

const HOUR_OPTS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MIN_OPTS = Array.from({ length: 12 }, (_, i) => pad(i * 5));

// A 3-part 12-hour time picker (hour / minute / AM-PM) that stores its value
// as a plain 24h "HH:MM" string, so the rest of the app (duration calc,
// Supabase columns) doesn't need to change.
function TimePicker12({ value, onChange, accentColor, label = 'Time' }) {
  const { h12, min, period } = to12(value);
  const selStyle = { flex: 1, minWidth: 0, height: 40, padding: '0 4px', fontSize: 14, textAlign: 'center', textAlignLast: 'center', boxSizing: 'border-box', background: '#fff' };
  const set = (nh, nm, np) => onChange(to24(nh, nm, np));
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
      <select className="form-select" style={selStyle} value={h12} aria-label={`${label} hour`}
        onChange={(e) => set(e.target.value, min || '00', period)}>
        <option value="">--</option>
        {HOUR_OPTS.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true" style={{ color: accentColor || 'var(--gray)', fontWeight: 700, flexShrink: 0 }}>:</span>
      <select className="form-select" style={selStyle} value={min} aria-label={`${label} minutes`}
        onChange={(e) => set(h12 || '12', e.target.value, period)}>
        <option value="">--</option>
        {MIN_OPTS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="form-select" style={{ ...selStyle, flex: '0 0 60px' }} value={period} aria-label={`${label} AM or PM`}
        onChange={(e) => set(h12 || '12', min || '00', e.target.value)}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

// Centered picker popup — same look as FeesTab / EnquiryTab. Props unchanged.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      className="cl-overlay"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="cl-popup" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '14px 12px 10px', width: '100%', maxWidth: 320, maxHeight: 'min(68vh, 480px)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(10,18,35,.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: 6, padding: '0 4px', flexShrink: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A336A', textAlign: 'center' }}>{title}</div>
          <button type="button" className="cl-iconbtn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 0, width: 28, height: 28, borderRadius: '50%', background: '#F1F3F8', border: 'none', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <FormIcon name="x" size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, minHeight: 42, padding: '8px 10px', borderRadius: 10,
      cursor: 'pointer', margin: '2px 0', background: checked ? 'rgba(91,124,196,.12)' : 'transparent',
      color: checked ? '#1A336A' : '#333', fontWeight: checked ? 600 : 500, transition: 'background .15s ease, color .15s ease',
    }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} style={{ width: 18, height: 18, accentColor: '#1A336A', flexShrink: 0, cursor: 'pointer' }} />
      {label}
    </label>
  );
}

// Equal-size filter chip, light blue when a filter is applied (same as FeesTab).
function chipStyle(on) {
  return {
    flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0,
    height: 36, fontSize: 12, fontWeight: 600, padding: '0 8px', borderRadius: 10, fontFamily: 'inherit',
    border: `1px solid ${on ? '#5B7CC4' : 'var(--border)'}`,
    background: on ? 'rgba(91,124,196,.10)' : 'var(--card2)', color: '#1A336A', cursor: 'pointer',
  };
}

const VIEW_TYPE_OPTIONS = [
  { v: 'day', l: 'Day' },
  { v: 'month', l: 'Month' },
  { v: 'year', l: 'Year' },
];

// Lucide-style outline icons (inline, so no extra dependency is needed).
const FORM_ICONS = {
  clipboardList: <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  layers: <><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  notebookPen: <><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /><path d="M2 6h4M2 10h4M2 14h4M2 18h4" /><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" /></>,
  save: <><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M5 12h14M12 5v14" />,
  funnel: <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  trash: <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />,
  userRound: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  logIn: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></>,
  logOut: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  fileText: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  sheet: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6M8 13h2M14 13h2M8 17h2M14 17h2" /></>,
};

function FormIcon({ name, size = 14, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {FORM_ICONS[name]}
    </svg>
  );
}

const CL_TONES = {
  neutral: { bg: 'var(--card2, #F1F5FB)', color: '#475569', border: 'var(--border, #DCE4F2)' },
  info:    { bg: 'rgba(91,124,196,.10)', color: '#1A336A', border: 'rgba(91,124,196,.22)' },
  success: { bg: '#ECFDF5', color: '#15803D', border: '#BBF7D0' },
  danger:  { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
};
function ClChip({ icon, tone = 'neutral', children }) {
  const t = CL_TONES[tone] || CL_TONES.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 7px', boxSizing: 'border-box', fontSize: 11, fontWeight: 600, lineHeight: 1, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 6, whiteSpace: 'nowrap', maxWidth: '100%', flexShrink: 0 }}>
      {icon && <FormIcon name={icon} size={12} stroke={2.2} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </span>
  );
}

const CL_PAGE_CSS = `
.cl-chip{transition:border-color .15s ease,background-color .15s ease,transform .12s ease}
.cl-chip:hover{border-color:#9DB2DD}
.cl-chip:active:not(:disabled){transform:scale(.97)}
.cl-chip:focus-visible,.cl-iconbtn:focus-visible,.cl-head:focus-visible,.cl-act:focus-visible,.cl-field:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.cl-act{transition:background-color .15s ease,border-color .15s ease,transform .12s ease}
.cl-act:active{transform:scale(.95)}
.cl-card{display:flex;align-items:flex-start;gap:10px;padding:12px;margin-bottom:8px;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:0 1px 2px rgba(16,32,64,.05);box-sizing:border-box;max-width:100%;transition:border-color .15s ease,box-shadow .15s ease}
@media (hover:hover){.cl-card:hover{border-color:#B9C7E6;box-shadow:0 2px 8px rgba(16,32,64,.07)}}
.cl-field{width:100%;height:40px;box-sizing:border-box;padding:0 12px;border:1px solid var(--border);border-radius:10px;background:var(--card2);font-size:14px;color:#182238;font-family:inherit;outline:none;min-width:0}
.cl-field:focus{border-color:#5B7CC4;box-shadow:0 0 0 3px rgba(91,124,196,.18);background:#fff}
@keyframes cl-fade{from{opacity:0}to{opacity:1}}
@keyframes cl-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.cl-overlay{animation:cl-fade .15s ease}
.cl-popup,.cl-panel{animation:cl-pop .16s ease}
@media (prefers-reduced-motion:reduce){.cl-chip,.cl-act,.cl-card,.cl-overlay,.cl-popup,.cl-panel{animation:none !important;transition:none !important}}
`;

const CL_CSS = `
.cl-sheet button:focus-visible,.cl-sheet input:focus-visible,.cl-sheet select:focus-visible,.cl-sheet textarea:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.cl-sheet .cl-btn{transition:transform .12s ease,background-color .15s ease,opacity .15s ease}
.cl-sheet .cl-btn:active:not(:disabled){transform:scale(.98)}
.cl-sheet .cl-btn:disabled{opacity:.6;cursor:not-allowed}
.cl-grid{display:grid;gap:10px}
.cl-grid.cl-2{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.cl-grid.cl-time{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
`;

function FieldLabel({ htmlFor, id, icon, required, children }) {
  return (
    <label htmlFor={htmlFor} id={id} className="form-label"
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 5 }}>
      {icon && <FormIcon name={icon} size={13} />}
      <span>{children}{required && <span aria-hidden="true" style={{ color: '#B91C1C' }}> *</span>}</span>
    </label>
  );
}

// Shared presentation for both the Add and Edit class-log forms. It holds no
// state and no business logic — every value and handler comes from the page.
function ClassLogSheet({
  idp, mode, subtitle, values, sportOptions, batchOptions,
  onDate, onSport, onBatch, onInTime, onOutTime, onNote,
  onClose, onSubmit, submitLabel, busy,
}) {
  const duration = calcDuration(values.inTime, values.outTime);
  const titleId = `${idp}-title`;
  const ctl = { width: '100%', minWidth: 0, height: 40, fontSize: 14, padding: '0 10px', boxSizing: 'border-box', background: '#fff' };
  return (
    <div
      className="modal-overlay active"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 62, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(10,20,40,.55)', padding: 0, boxSizing: 'border-box' }}
      onClick={onClose}
    >
      <div
        className="cl-sheet"
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--card, #fff)', border: '1px solid var(--border)', borderBottom: 'none',
          borderRadius: '16px 16px 0 0', boxShadow: '0 -6px 20px rgba(10,20,40,.16)', boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{CL_CSS}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px 10px', flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(91,124,196,.12)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FormIcon name="clipboardList" size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div id={titleId} style={{ fontWeight: 700, fontSize: 17, color: '#182238', lineHeight: 1.2 }}>
                {mode === 'edit' ? 'Edit Class Log' : 'Add Class Log'}
              </div>
              {subtitle && <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2, overflowWrap: 'anywhere' }}>{subtitle}</div>}
            </div>
          </div>
          <button type="button" className="cl-btn" onClick={onClose} aria-label="Close class log form"
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
            <FormIcon name="x" size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          onFocus={(e) => { const t = e.target; setTimeout(() => t.scrollIntoView?.({ block: 'nearest' }), 250); }}
          style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '2px 14px 12px', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div style={{ minWidth: 0 }}>
            <FieldLabel htmlFor={`${idp}-date`} icon="calendar" required>Date</FieldLabel>
            <input id={`${idp}-date`} type="date" className="form-input" style={ctl}
              value={values.date} onChange={(e) => onDate(e.target.value)} />
          </div>

          <div className="cl-grid cl-2">
            <div style={{ minWidth: 0 }}>
              <FieldLabel htmlFor={`${idp}-sport`} icon="trophy">Sport</FieldLabel>
              <select id={`${idp}-sport`} className="form-select" style={ctl} value={values.sport}
                onChange={(e) => onSport(e.target.value)}>
                <option value="">— Select —</option>
                {sportOptions.map(sp => <option key={sp} value={sp}>{sp}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <FieldLabel htmlFor={`${idp}-batch`} icon="layers" required>Batch</FieldLabel>
              <select id={`${idp}-batch`} className="form-select" style={ctl} value={values.batch}
                onChange={(e) => onBatch(e.target.value)}>
                <option value="">{values.sport ? '— Select —' : '— sport first —'}</option>
                {batchOptions.map(b => <option key={b.name} value={b.name}>{b.batchLabel}</option>)}
              </select>
            </div>
          </div>

          {/* Class timing */}
          <div role="group" aria-labelledby={`${idp}-timing`} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, minHeight: 22 }}>
              <span id={`${idp}-timing`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#1A336A' }}>
                <FormIcon name="clock" size={14} /> Class timing
              </span>
              {duration && (
                <span aria-label={`Duration ${duration}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', boxSizing: 'border-box', fontSize: 11, fontWeight: 600, lineHeight: 1, background: 'rgba(91,124,196,.10)', color: '#1A336A', border: '1px solid rgba(91,124,196,.22)', borderRadius: 6, whiteSpace: 'nowrap' }}>
                  <FormIcon name="clock" size={12} stroke={2.2} /> {duration}
                </span>
              )}
            </div>
            <div className="cl-grid cl-time">
              <div role="group" aria-labelledby={`${idp}-in`} style={{ minWidth: 0 }}>
                <div id={`${idp}-in`} style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>In time</div>
                <TimePicker12 label="In time" value={values.inTime} onChange={onInTime} />
              </div>
              <div role="group" aria-labelledby={`${idp}-out`} style={{ minWidth: 0 }}>
                <div id={`${idp}-out`} style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>Out time</div>
                <TimePicker12 label="Out time" value={values.outTime} onChange={onOutTime} />
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <FieldLabel htmlFor={`${idp}-note`} icon="notebookPen">
              Notes <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(optional)</span>
            </FieldLabel>
            <textarea id={`${idp}-note`} className="form-input" rows={4}
              style={{ resize: 'vertical', minHeight: 88, width: '100%', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.45, padding: '9px 10px', background: '#fff', overflowWrap: 'anywhere' }}
              placeholder="e.g. Warm-up, basics, drills…"
              value={values.note} onChange={(e) => onNote(e.target.value)} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--card, #fff)', flex: '0 0 auto' }}>
          <button type="button" className="btn btn-outline cl-btn" onClick={onClose}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, color: '#1A336A', fontWeight: 600, fontSize: 13.5 }}>Cancel</button>
          <button type="button" className="btn btn-primary cl-btn" disabled={busy} onClick={onSubmit}
            style={{ flex: 1.6, minHeight: 44, borderRadius: 12, background: '#1A336A', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <FormIcon name={mode === 'edit' ? 'save' : 'check'} size={16} /> {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClassLogPage() {
  const { academyId, isAdmin, appUser, assignedSports, assignedBatches, canExport } = useAuth();
  const { visibleSports, visibleBatches } = useAcademyData();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters — default to "All Sports" / "All Batches" (empty string), never
  // auto-selected to a specific sport/batch on load.
  const [filterSport, setFilterSport] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [viewType, setViewType] = useState('month'); // day | month | year
  const [filterDate, setFilterDate] = useState(todayStr());
  const [filterMonth, setFilterMonth] = useState(todayStr().slice(0, 7));
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [popup, setPopup] = useState(null); // 'sport' | 'batch' | 'staff' | 'viewType' | 'year' | null
  const [filtersOpen, setFiltersOpen] = useState(false); // filter card collapsed by default (UI only)

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Edit modal (admin only)
  const [editEntry, setEditEntry] = useState(null);

  const staffName = appUser?.name || appUser?.id || 'Unknown';

  const { isAtLimit, limits, plan, nextPlanForLimit } = usePlan();
  // Academy-wide total (not scoped to this user) — the plan caps how many
  // class log rows the *academy* stores in total, admin + all staff combined.
  const [classLogCount, setClassLogCount] = useState(0);
  const atClassLogLimit = isAtLimit('classLogs', classLogCount);

  const fetchClassLogCount = async () => {
    if (!academyId) return;
    const { count } = await supabase
      .from('class_log')
      .select('*', { count: 'exact', head: true })
      .eq('academy_id', academyId);
    setClassLogCount(count ?? 0);
  };

  const fetchEntries = async () => {
    if (!academyId) return;
    setLoading(true);
    let query = supabase
      .from('class_log')
      .select('*')
      .eq('academy_id', academyId)
      .order('date', { ascending: false });
    // Staff only ever see their own logged entries — scope it at the query
    // level so their own data never even leaves the DB, not just hidden client-side.
    if (!isAdmin) query = query.eq('created_by', staffName);
    const { data } = await query;
    setEntries((data || []).map(c => ({
      id: c.id, date: c.date, sport: c.sport || '', batch: c.batch,
      inTime: c.in_time, outTime: c.out_time, duration: c.duration,
      note: c.note, by: c.created_by, at: c.created_at,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); fetchClassLogCount(); }, [academyId, isAdmin, staffName]);

  // Realtime: keep the list in sync as admin/staff add, edit, or delete entries.
  useEffect(() => {
    if (!academyId) return;
    const channel = supabase
      .channel(`class_log-${academyId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'class_log',
        filter: `academy_id=eq.${academyId}`,
      }, (payload) => {
        const toEntry = (c) => ({
          id: c.id, date: c.date, sport: c.sport || '', batch: c.batch,
          inTime: c.in_time, outTime: c.out_time, duration: c.duration,
          note: c.note, by: c.created_by, at: c.created_at,
        });
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old;
          if (!oldRow) return;
          setEntries(prev => prev.filter(e => e.id !== oldRow.id));
          setClassLogCount(c => Math.max(0, c - 1));
        } else {
          const row = payload.new;
          if (!row) return;
          if (payload.eventType === 'INSERT') setClassLogCount(c => c + 1);
          // Staff channel receives every academy row (filter only supports
          // academy_id) — drop anything that isn't their own entry from the
          // visible list (the count above still reflects the full academy).
          if (!isAdmin && row.created_by !== staffName) return;
          const entry = toEntry(row);
          setEntries(prev => {
            const idx = prev.findIndex(e => e.id === entry.id);
            if (idx === -1) return [entry, ...prev];
            const next = prev.slice();
            next[idx] = entry;
            return next;
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [academyId, isAdmin, staffName]);

  // Sport options — staff limited to assigned sports
  const sportOptions = useMemo(() => {
    const names = visibleSports.map(s => s.name);
    return isAdmin ? names : names.filter(n => assignedSports.includes(n));
  }, [visibleSports, isAdmin, assignedSports]);

  // Batch options for the ADD form, cascading off form.sport
  const addBatchOptions = useMemo(() => {
    let list = visibleBatches.filter(b => b.sport === form.sport);
    if (!isAdmin && assignedBatches.length) list = list.filter(b => assignedBatches.includes(b.name));
    return list;
  }, [visibleBatches, form.sport, isAdmin, assignedBatches]);

  // Batch options for the FILTER row, cascading off filterSport
  const filterBatchOptions = useMemo(() => {
    let list = filterSport ? visibleBatches.filter(b => b.sport === filterSport) : visibleBatches;
    if (!isAdmin && assignedBatches.length) list = list.filter(b => assignedBatches.includes(b.name));
    return list;
  }, [visibleBatches, filterSport, isAdmin, assignedBatches]);

  const filteredList = useMemo(() => {
    let list = [...entries];
    if (filterSport) list = list.filter(e => (e.sport || '') === filterSport);
    if (filterBatch) list = list.filter(e => e.batch === filterBatch);
    if (isAdmin && filterStaff) list = list.filter(e => e.by === filterStaff);
    if (viewType === 'day' && filterDate) list = list.filter(e => e.date === filterDate);
    else if (viewType === 'year' && filterYear) list = list.filter(e => (e.date || '').startsWith(filterYear + '-'));
    else if (viewType === 'month' && filterMonth) list = list.filter(e => (e.date || '').startsWith(filterMonth));
    return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [entries, filterSport, filterBatch, filterStaff, isAdmin, viewType, filterDate, filterMonth, filterYear]);

  // Staff names available to filter by (admin only) — derived from logged entries
  const staffOptions = useMemo(() => {
    const names = Array.from(new Set(entries.map(e => e.by).filter(Boolean)));
    return names.sort();
  }, [entries]);

  // Batch options for the EDIT form, cascading off editEntry.sport
  const editBatchOptions = useMemo(() => {
    if (!editEntry) return [];
    let list = visibleBatches.filter(b => b.sport === editEntry.sport);
    if (!isAdmin && assignedBatches.length) list = list.filter(b => assignedBatches.includes(b.name));
    return list;
  }, [visibleBatches, editEntry?.sport, isAdmin, assignedBatches]);

  const resetForm = () => setForm({ ...emptyForm, date: todayStr() });

  // Staff can edit an entry by default when it's their own AND falls within
  // their currently assigned sport/batch (an empty assignedSports/assignedBatches
  // array means "no restriction", matching how it's used elsewhere on this page).
  const canEditEntry = (entry) => {
    if (isAdmin) return true;
    if (entry.by !== staffName) return false;
    const sportOk = !assignedSports.length || assignedSports.includes(entry.sport);
    const batchOk = !assignedBatches.length || assignedBatches.includes(entry.batch);
    return sportOk && batchOk;
  };

  const openAdd = () => {
    if (atClassLogLimit) return;
    resetForm();
    setShowAdd(true);
  };

  const saveNewEntry = async () => {
    if (atClassLogLimit) {
      alert(`Limit reached (${limits.classLogs} class log entries) on your ${plan?.name || 'current'} plan.`);
      return;
    }
    if (!form.date) { alert('Please select a date'); return; }
    if (!form.batch) { alert('Please select a batch'); return; }
    setSaving(true);
    const duration = calcDuration(form.inTime, form.outTime);
    const row = {
      academy_id: academyId,
      date: form.date, sport: form.sport || '', batch: form.batch,
      in_time: form.inTime || '', out_time: form.outTime || '',
      duration, note: form.note.trim(), created_by: staffName,
    };
    const { error } = await supabase.from('class_log').insert(row);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    logActivity({ academyId, actorId: appUser?.id, actorName: staffName, message: `Added class log entry for ${form.batch} on ${form.date}` });
    setShowAdd(false);
    resetForm();
    fetchEntries();
  };

  const openEdit = (entry) => {
    if (!canEditEntry(entry)) return;
    setEditEntry({ ...entry });
  };

  const saveEdit = async () => {
    if (!canEditEntry(editEntry)) {
      alert("You don't have permission to edit this entry.");
      return;
    }
    if (!editEntry.date) { alert('Please select a date'); return; }
    if (!editEntry.batch) { alert('Please select a batch'); return; }
    const duration = calcDuration(editEntry.inTime, editEntry.outTime);
    const { data, error } = await supabase.from('class_log').update({
      date: editEntry.date, batch: editEntry.batch, sport: editEntry.sport || '',
      in_time: editEntry.inTime || '', out_time: editEntry.outTime || '',
      duration, note: (editEntry.note || '').trim(),
    }).eq('id', editEntry.id).select();
    if (error) { alert('Save failed: ' + error.message); return; }
    // update() succeeds with an empty result (no error) when Supabase RLS
    // silently blocks the write for this user — surface that distinctly so
    // it isn't mistaken for a successful, no-op save.
    if (!data || data.length === 0) {
      alert("Save didn't go through — you may not have permission to edit this entry (check Supabase RLS policies for staff updates on class_log).");
      return;
    }
    logActivity({ academyId, actorId: appUser?.id, actorName: staffName, message: `Edited class log entry for ${editEntry.batch} on ${editEntry.date}` });
    setEditEntry(null);
    fetchEntries();
  };

  const deleteEntry = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm('Delete this class log entry?')) return;
    const entryRow = entries.find(e => e.id === id);
    const { error } = await supabase.from('class_log').delete().eq('id', id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    logActivity({ academyId, actorId: appUser?.id, actorName: staffName, message: `Deleted class log entry for ${entryRow?.batch || ''} on ${entryRow?.date || ''}` });
    fetchEntries();
  };

  const exportRows = () => filteredList.map(e => [
    e.date, e.sport, e.batch, fmt12(e.inTime), fmt12(e.outTime), e.duration || '', e.note || '', e.by || '',
  ]);
  const exportCols = ['Date', 'Sport', 'Batch', 'In Time', 'Out Time', 'Duration', 'Note', 'Logged By'];

  const handleExportPdf = () => {
    const title = isAdmin ? 'Class Log — All' : 'My Class Log';
    exportGenericPdf(title, exportCols, exportRows(), `ClassLog_${todayStr().replace(/-/g, '')}.pdf`);
  };
  const handleExportXlsx = () => {
    exportGenericXlsx(
      exportRows().map(r => Object.fromEntries(exportCols.map((c, i) => [c, r[i]]))),
      `ClassLog_${todayStr().replace(/-/g, '')}.xlsx`,
      'Class Log'
    );
  };

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => String(y - i));
  }, []);

  const monthLabel = (m) => { const [y, mo] = (m || '').split('-'); return y && mo ? `${MONTHS[parseInt(mo, 10) - 1]} ${y}` : ''; };
  const periodLabel = viewType === 'day' ? filterDate : viewType === 'year' ? filterYear : monthLabel(filterMonth);
  const batchFilterLabel = filterBatchOptions.find(b => b.name === filterBatch)?.batchLabel;
  const filterSummary = [filterSport, batchFilterLabel, isAdmin ? filterStaff : ''].filter(Boolean).join(' · ');
  const roundBtn = { width: 36, height: 36, borderRadius: '50%', border: '2px solid #04213A', padding: 0, flexShrink: 0, background: '#fff', color: '#04213A', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(4,33,58,.2)' };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <style>{CL_PAGE_CSS}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
          <FormIcon name="clipboardList" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>Class Log</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
          {canExport && (
            <>
              <button type="button" className="cl-act" style={roundBtn} onClick={handleExportPdf} aria-label="Export PDF" title="Export PDF"><FormIcon name="fileText" size={17} /></button>
              <button type="button" className="cl-act" style={roundBtn} onClick={handleExportXlsx} aria-label="Export Excel" title="Export Excel"><FormIcon name="sheet" size={17} /></button>
            </>
          )}
          <LimitGatedButton
            resource="classLogs"
            currentCount={classLogCount}
            className="btn btn-primary"
            style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, fontWeight: 700, background: '#1A336A', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={openAdd}
          ><FormIcon name="plus" size={16} stroke={2.4} /> Add</LimitGatedButton>
        </div>
      </div>

      {/* Filters card — same look as FeesTab / EnquiryTab */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '4px 10px', marginBottom: 8, boxShadow: '0 1px 2px rgba(16,32,64,.05)', flexShrink: 0 }}>
        <div
          className="cl-head"
          role="button" tabIndex={0} aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(v => !v)}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFiltersOpen(v => !v); } }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', minHeight: 36 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ display: 'flex', color: '#1A336A' }} aria-hidden="true"><FormIcon name="calendar" size={18} /></span>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#182238', whiteSpace: 'nowrap' }}>{periodLabel}</span>
            {filterSummary && (
              <span style={{ fontSize: 11.5, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{filterSummary}</span>
            )}
          </div>
          <button type="button" className="cl-iconbtn"
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'var(--card2)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            aria-label={filtersOpen ? 'Collapse filters' : 'Expand filters'} aria-expanded={filtersOpen}
            onClick={(e) => { e.stopPropagation(); setFiltersOpen(v => !v); }}>
            <FormIcon name={filtersOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        </div>

        {filtersOpen && (
          <div className="cl-panel" style={{ marginTop: 8, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--card2)', border: '1px solid var(--border)' }}>
              {VIEW_TYPE_OPTIONS.map(o => (
                <button key={o.v} type="button" className="cl-chip" aria-pressed={viewType === o.v}
                  style={{ flex: 1, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, background: viewType === o.v ? '#1A336A' : 'transparent', color: viewType === o.v ? '#fff' : '#1A336A' }}
                  onClick={() => setViewType(o.v)}>
                  {o.l}
                </button>
              ))}
            </div>

            {viewType === 'day' && (
              <input type="date" className="cl-field" aria-label="Select date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
            )}
            {viewType === 'month' && (
              <input type="month" className="cl-field" aria-label="Select month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
            )}
            {viewType === 'year' && (
              <button type="button" className="cl-chip" style={{ ...chipStyle(false), flex: 'none', width: '100%', height: 40 }} onClick={() => setPopup('year')} aria-haspopup="dialog" aria-label="Select year">
                <span>{filterYear}</span>
                <FormIcon name="chevronDown" size={13} />
              </button>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="cl-chip" style={chipStyle(!!filterSport)} onClick={() => setPopup('sport')} aria-haspopup="dialog" aria-label="Filter by sport">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filterSport || 'All Sports'}</span>
                <FormIcon name="chevronDown" size={13} />
              </button>
              <button type="button" className="cl-chip" style={chipStyle(!!filterBatch)} onClick={() => setPopup('batch')} aria-haspopup="dialog" aria-label="Filter by batch">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{batchFilterLabel || 'All Batches'}</span>
                <FormIcon name="chevronDown" size={13} />
              </button>
            </div>
            {isAdmin && (
              <button type="button" className="cl-chip" style={{ ...chipStyle(!!filterStaff), flex: 'none', width: '100%' }} onClick={() => setPopup('staff')} aria-haspopup="dialog" aria-label="Filter by staff">
                <FormIcon name="userRound" size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filterStaff || 'All Staff/Admins'}</span>
                <FormIcon name="chevronDown" size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {popup === 'sport' && (
        <FilterPopup title="Select Sport" onClose={() => setPopup(null)}>
          <RadioRow name="sportsel" checked={!filterSport} onChange={() => { setFilterSport(''); setFilterBatch(''); setPopup(null); }} label="All Sports" />
          {sportOptions.map(sp => (
            <RadioRow key={sp} name="sportsel" checked={filterSport === sp} onChange={() => { setFilterSport(sp); setFilterBatch(''); setPopup(null); }} label={sp} />
          ))}
        </FilterPopup>
      )}

      {popup === 'batch' && (
        <FilterPopup title="Select Batch" onClose={() => setPopup(null)}>
          <RadioRow name="batchsel" checked={!filterBatch} onChange={() => { setFilterBatch(''); setPopup(null); }} label="All Batches" />
          {filterBatchOptions.map(b => (
            <RadioRow key={b.name} name="batchsel" checked={filterBatch === b.name} onChange={() => { setFilterBatch(b.name); setPopup(null); }} label={`${b.sport} : ${b.batchLabel}`} />
          ))}
        </FilterPopup>
      )}

      {popup === 'staff' && isAdmin && (
        <FilterPopup title="Filter by Staff" onClose={() => setPopup(null)}>
          <RadioRow name="staffsel" checked={!filterStaff} onChange={() => { setFilterStaff(''); setPopup(null); }} label="All Staff/Admins" />
          {staffOptions.map(n => (
            <RadioRow key={n} name="staffsel" checked={filterStaff === n} onChange={() => { setFilterStaff(n); setPopup(null); }} label={n} />
          ))}
        </FilterPopup>
      )}

      {popup === 'year' && (
        <FilterPopup title="Select Year" onClose={() => setPopup(null)}>
          {yearOptions.map(y => (
            <RadioRow key={y} name="yearsel" checked={filterYear === y} onChange={() => { setFilterYear(y); setPopup(null); }} label={y} />
          ))}
        </FilterPopup>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30, fontSize: 13 }}>Loading…</div>
      ) : filteredList.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--gray)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#9DB2DD' }}><FormIcon name="clipboardList" size={28} /></span>
          No entries found.
        </div>
      ) : (
        filteredList.map(e => {
          const d = new Date(e.date + 'T00:00:00');
          const dateDisp = `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          const inDisp = fmt12(e.inTime);
          const outDisp = fmt12(e.outTime);
          const bk = parseBatchKey(e.batch);
          return (
            <div key={e.id} className="cl-card">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#182238', lineHeight: 1.25 }}>{dateDisp}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  <ClChip icon="layers" tone="info">{bk.sport} : {bk.label}</ClChip>
                  {inDisp && <ClChip icon="logIn" tone="success">In {inDisp}</ClChip>}
                  {outDisp && <ClChip icon="logOut" tone="danger">Out {outDisp}</ClChip>}
                  {e.duration && <ClChip icon="clock" tone="neutral">{e.duration}</ClChip>}
                </div>
                {e.note && <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, marginTop: 8, overflowWrap: 'anywhere' }}>{e.note}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--gray)', marginTop: 8 }}>
                  <FormIcon name="userRound" size={12} />
                  <span style={{ overflowWrap: 'anywhere' }}>{e.by} · {e.at ? new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
              </div>
              {canEditEntry(e) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="cl-act" onClick={() => openEdit(e)} aria-label={`Edit class log for ${dateDisp}`} title="Edit"
                    style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: '#fff', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                    <FormIcon name="pencil" size={16} />
                  </button>
                  {isAdmin && (
                    <button type="button" className="cl-act" onClick={() => deleteEntry(e.id)} aria-label={`Delete class log for ${dateDisp}`} title="Delete"
                      style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                      <FormIcon name="trash" size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ── Add Modal ── */}
      {showAdd && (
        <ClassLogSheet
          idp="cl-add" mode="add"
          values={{ date: form.date, sport: form.sport, batch: form.batch, inTime: form.inTime, outTime: form.outTime, note: form.note }}
          sportOptions={sportOptions} batchOptions={addBatchOptions}
          onDate={(v) => setForm(f => ({ ...f, date: v }))}
          onSport={(v) => setForm(f => ({ ...f, sport: v, batch: '' }))}
          onBatch={(v) => setForm(f => ({ ...f, batch: v }))}
          onInTime={(v) => setForm(f => ({ ...f, inTime: v }))}
          onOutTime={(v) => setForm(f => ({ ...f, outTime: v }))}
          onNote={(v) => setForm(f => ({ ...f, note: v }))}
          onClose={() => setShowAdd(false)}
          onSubmit={saveNewEntry}
          submitLabel={saving ? 'Saving…' : 'Create Class Log'}
          busy={saving}
        />
      )}

      {/* ── Edit Modal ── */}
      {editEntry && (
        <ClassLogSheet
          idp="cl-edit" mode="edit"
          subtitle={editEntry.by ? `Logged by ${editEntry.by}` : undefined}
          values={{ date: editEntry.date || '', sport: editEntry.sport || '', batch: editEntry.batch || '', inTime: editEntry.inTime || '', outTime: editEntry.outTime || '', note: editEntry.note || '' }}
          sportOptions={sportOptions} batchOptions={editBatchOptions}
          onDate={(v) => setEditEntry(e => ({ ...e, date: v }))}
          onSport={(v) => setEditEntry(e => ({ ...e, sport: v, batch: '' }))}
          onBatch={(v) => setEditEntry(e => ({ ...e, batch: v }))}
          onInTime={(v) => setEditEntry(e => ({ ...e, inTime: v }))}
          onOutTime={(v) => setEditEntry(e => ({ ...e, outTime: v }))}
          onNote={(v) => setEditEntry(e => ({ ...e, note: v }))}
          onClose={() => setEditEntry(null)}
          onSubmit={saveEdit}
          submitLabel="Save Changes"
        />
      )}
    </div>
  );
}
