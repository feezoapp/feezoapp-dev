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

// Same centered popup used by StudentsTab's / AttendanceTab's / HomeTab's /
// FeesTab's / EnquiryTab's filters — a dark overlay + a card of radio rows,
// closing itself on selection.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 12, padding: 14, width: '85%', maxWidth: 320, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--gray)', cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '7px 2px', cursor: 'pointer' }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

const VIEW_TYPE_OPTIONS = [
  { v: 'day', l: '📅 Day' },
  { v: 'month', l: '📆 Month' },
  { v: 'year', l: '🗓️ Year' },
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
};

function FormIcon({ name, size = 14, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {FORM_ICONS[name]}
    </svg>
  );
}

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

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 6, flexWrap: 'wrap' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>📋 Class Log</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canExport && (
            <>
              <button className="btn" style={{ background: 'var(--gold)', color: '#fff', fontSize: 11, padding: '7px 10px' }} onClick={handleExportPdf}>PDF</button>
              <button className="btn" style={{ background: '#16a34a', color: '#fff', fontSize: 11, padding: '7px 10px' }} onClick={handleExportXlsx}>XL</button>
            </>
          )}
          <LimitGatedButton
            resource="classLogs"
            currentCount={classLogCount}
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '7px 12px' }}
            onClick={openAdd}
          >+ Add</LimitGatedButton>
        </div>
      </div>

      {/* Sport / Batch filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 7, flexWrap: 'wrap' }}>
        <button
          className="btn btn-outline btn-sm"
          style={{ flex: 1, minWidth: 100, padding: '7px 10px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={() => setPopup('sport')}
        >
          {filterSport || 'All Sports'}
        </button>
        <button
          className="btn btn-outline btn-sm"
          style={{ flex: 1, minWidth: 100, padding: '7px 10px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={() => setPopup('batch')}
        >
          {filterBatchOptions.find(b => b.name === filterBatch)?.batchLabel || 'All Batches'}
        </button>
      </div>

      {/* Staff filter (admin only) */}
      {isAdmin && (
        <div style={{ marginBottom: 7 }}>
          <button
            className="btn btn-outline btn-sm"
            style={{ width: '100%', padding: '7px 10px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => setPopup('staff')}
          >
            {filterStaff || '👤 All Staff/Admins'}
          </button>
        </div>
      )}

      {/* Day / Month / Year view */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-outline btn-sm"
          style={{ flex: '0 0 auto', padding: '7px 10px', fontSize: 12 }}
          onClick={() => setPopup('viewType')}
        >
          {VIEW_TYPE_OPTIONS.find(o => o.v === viewType)?.l}
        </button>
        {viewType === 'day' && (
          <input type="date" className="form-input" style={{ flex: 1, minWidth: 120, padding: '7px 10px', fontSize: 12 }}
            value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
        )}
        {viewType === 'month' && (
          <input type="month" className="form-input" style={{ flex: 1, minWidth: 120, padding: '7px 10px', fontSize: 12 }}
            value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
        )}
        {viewType === 'year' && (
          <button
            className="btn btn-outline btn-sm"
            style={{ flex: 1, minWidth: 100, padding: '7px 10px', fontSize: 12 }}
            onClick={() => setPopup('year')}
          >
            {filterYear}
          </button>
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
          <RadioRow name="staffsel" checked={!filterStaff} onChange={() => { setFilterStaff(''); setPopup(null); }} label="👤 All Staff/Admins" />
          {staffOptions.map(n => (
            <RadioRow key={n} name="staffsel" checked={filterStaff === n} onChange={() => { setFilterStaff(n); setPopup(null); }} label={n} />
          ))}
        </FilterPopup>
      )}

      {popup === 'viewType' && (
        <FilterPopup title="Select View" onClose={() => setPopup(null)}>
          {VIEW_TYPE_OPTIONS.map(o => (
            <RadioRow key={o.v} name="viewtypesel" checked={viewType === o.v} onChange={() => { setViewType(o.v); setPopup(null); }} label={o.l} />
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
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30 }}>Loading…</div>
      ) : filteredList.length === 0 ? (
        <div className="empty-state" style={{ padding: 20, textAlign: 'center', color: 'var(--gray)' }}>No entries found.</div>
      ) : (
        filteredList.map(e => {
          const d = new Date(e.date + 'T00:00:00');
          const dateDisp = `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          const inDisp = fmt12(e.inTime);
          const outDisp = fmt12(e.outTime);
          return (
            <div key={e.id} className="card" style={{ padding: '11px 13px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>{dateDisp}</span>
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>{parseBatchKey(e.batch).sport} : {parseBatchKey(e.batch).label}</span>
                </div>
                {(inDisp || outDisp) && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    {inDisp && <span style={{ fontSize: 12, fontWeight: 600 }}><span style={{ color: '#4ade80' }}>🟢 In:</span> {inDisp}</span>}
                    {outDisp && <span style={{ fontSize: 12, fontWeight: 600 }}><span style={{ color: '#f87171' }}>🔴 Out:</span> {outDisp}</span>}
                    {e.duration && <span className="badge badge-gold" style={{ fontSize: 10 }}>⏱ {e.duration}</span>}
                  </div>
                )}
                {e.note && <div style={{ fontSize: 12, color: 'var(--offwhite)', lineHeight: 1.5, marginBottom: 3 }}>{e.note}</div>}
                <div style={{ fontSize: 10, color: 'var(--graydk)' }}>
                  ✍️ {e.by} · {e.at ? new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
              {canEditEntry(e) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                  <button className="btn btn-primary" style={{ fontSize: 10, padding: '5px 8px' }} onClick={() => openEdit(e)}>✏️ Edit</button>
                  {isAdmin && (
                    <button className="btn" style={{ fontSize: 10, padding: '5px 8px', background: '#dc2626', color: '#fff' }} onClick={() => deleteEntry(e.id)}>🗑️ Delete</button>
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
