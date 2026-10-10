import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { usePlan } from '../context/PlanContext';
import { supabase } from '../lib/supabaseClient';
import { normalizePhone, isValidPhone } from '../lib/phone';
import AddStudentModal from '../components/AddStudentModal';

const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

const CONVERSION_OPTIONS = [
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
];
// Semantic tone per conversion level (same meaning as before: High = green, Medium = amber, Low = neutral).
const CONVERSION_BADGE = { High: 'success', Medium: 'warning', Low: 'neutral' };

// One shared palette for every metadata chip so they all look identical in size and weight.
const CHIP_TONES = {
  neutral: { bg: 'var(--card2, #F1F5FB)', color: '#475569', border: 'var(--border, #DCE4F2)' },
  info:    { bg: 'rgba(91,124,196,.10)', color: '#1A336A', border: 'rgba(91,124,196,.22)' },
  danger:  { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
  success: { bg: '#ECFDF5', color: '#15803D', border: '#BBF7D0' },
  warning: { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
};

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// Same centered popup used by StudentsTab's / AttendanceTab's / HomeTab's /
// FeesTab's Sport/Batch/Sort filters — a dark overlay + a card of radio
// rows, closing itself on selection.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 12, padding: 14, width: '85%', maxWidth: 320, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} aria-label="Close filter" className="eq-iconbtn" style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', display: 'flex', padding: 4 }}><SheetIcon name="x" size={18} /></button>
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

// Lucide-style outline icons (inline so no extra dependency is needed).
const SHEET_ICONS = {
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  mapPin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  medal: <><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" /><path d="M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8" /><circle cx="12" cy="17" r="5" /><path d="M12 18v-2h-.5" /></>,
  userRound: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  userCheck: <><path d="m16 11 2 2 4-4" /><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
  fileText: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  archive: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" /></>,
  archiveRestore: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h2M20 8v11a2 2 0 0 1-2 2h-2M9 15l3-3 3 3M12 12v9" /></>,
  trash: <><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  save: <><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" /></>,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  snowflake: <path d="m10 20-1.25-2.5L6 18M10 4 8.75 6.5 6 6M14 20l1.25-2.5L18 18M14 4l1.25 2.5L18 6M17 21l-3-6h-4M17 3l-3 6 1.5 3M2 12h6.5L10 9M20 10l-1.5 2 1.5 2M22 12h-6.5L14 15M4 10l1.5 2L4 14M7 21l3-6-1.5-3M7 3l3 6h4" />,
  messages: <><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" /></>,
  funnel: <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  calendarClock: <><path d="M16 14v2.2l1.6 1" /><path d="M16 2v4" /><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" /><path d="M3 10h5" /><path d="M8 2v4" /><circle cx="16" cy="16" r="6" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  alertCircle: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  notebookPen: <><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /><path d="M2 6h4M2 10h4M2 14h4M2 18h4" /><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" /></>,
};

function SheetIcon({ name, size = 16, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {SHEET_ICONS[name]}
    </svg>
  );
}

const BADGE_ICON = { High: 'flame', Medium: 'zap', Low: 'snowflake' };

// Compact, uniform chip: same height, padding, font size, radius and icon size everywhere.
function MetaChip({ icon, tone = 'neutral', children, title }) {
  const t = CHIP_TONES[tone] || CHIP_TONES.neutral;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 7px', boxSizing: 'border-box', fontSize: 11, fontWeight: 600, lineHeight: 1, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 6, whiteSpace: 'nowrap', maxWidth: '100%', flexShrink: 0 }}>
      {icon && <SheetIcon name={icon} size={12} stroke={2.2} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </span>
  );
}

function ConversionBadge({ ratio }) {
  if (!ratio) return null;
  return <MetaChip icon={BADGE_ICON[ratio] || 'snowflake'} tone={CONVERSION_BADGE[ratio] || 'neutral'}>{ratio}</MetaChip>;
}

const SHEET_CSS = `
.eq-sheet button:focus-visible,.eq-sheet a:focus-visible,.eq-sheet input:focus-visible,.eq-sheet select:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.eq-sheet .eq-btn{transition:transform .12s ease,background-color .15s ease,border-color .15s ease,opacity .15s ease}
.eq-sheet .eq-btn:active:not(:disabled){transform:scale(.98)}
`;

const EQ_CSS = `
.eq-card:focus-visible,.eq-fab:focus-visible,.eq-seg:focus-visible,.eq-iconbtn:focus-visible,.eq-filter-head:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.eq-fab{transition:transform .12s ease,box-shadow .15s ease,opacity .15s ease}
.eq-fab:active:not(:disabled){transform:scale(.96)}
.eq-seg{transition:background-color .15s ease,color .15s ease}
`;

function Field({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--gray)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

export default function EnquiryTab({ isActive = true }) {
  const { academyId, isAdmin, appUser } = useAuth();
  const { visibleSports, visibleBatches } = useAcademyData();
  const { isAtLimit, limits, plan, nextPlanForLimit } = usePlan();
  const [enquiries, setEnquiries] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Authoritative count straight from the DB (not derived from `enquiries`,
  // which may later be paginated/filtered). Archived rows are intentionally
  // included — the plan limit is on total enquiries ever created, not just
  // the active ones.
  const [enquiryCount, setEnquiryCount] = useState(0);
  const atEnquiryLimit = isAtLimit('enquiries', enquiryCount);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', phone: '', query: '', location: '', sport: '', conversionRatio: '', reminderDate: '', assignedTo: '' });
  const [addError, setAddError] = useState('');

  const [detail, setDetail] = useState(null); // the enquiry row being viewed
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [search, setSearch] = useState('');
  const [filterConv, setFilterConv] = useState('');
  const [filterSport, setFilterSport] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterReminder, setFilterReminder] = useState('');
  const [view, setView] = useState('active'); // 'active' | 'archive' (admin only)
  const [popup, setPopup] = useState(null); // 'conv' | 'sport' | 'staff' | null
  const [panelOpen, setPanelOpen] = useState(false); // filter panel: collapsed by default, matching AttendanceTab

  const [convertPrefill, setConvertPrefill] = useState(null);
  const [convertingEnqId, setConvertingEnqId] = useState(null);

  const notesScrollRef = useRef(null);
  const nameInputRef = useRef(null);

  const createdByName = appUser?.name || appUser?.id || 'Staff';

  const load = async () => {
    if (!academyId) return;
    setLoading(true);
    const [enqRes, countRes, usersRes] = await Promise.all([
      supabase.from('enquiries').select('*').eq('academy_id', academyId).order('created_at', { ascending: false }),
      // head:true → no rows returned, just the count. No `archived` filter,
      // so this counts active + archived together.
      supabase.from('enquiries').select('*', { count: 'exact', head: true }).eq('academy_id', academyId),
      isAdmin ? supabase.from('app_users').select('*').eq('academy_id', academyId) : Promise.resolve({ data: [] }),
    ]);
    setEnquiries(enqRes.data || []);
    setEnquiryCount(countRes.count ?? (enqRes.data || []).length);
    setStaffList(usersRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [academyId]);

  // This tab stays mounted (display:none) when the user swipes away, but its
  // FAB/modals are createPortal'd straight to document.body — that ignores
  // the display:none, so they'd otherwise keep floating over other tabs.
  // Closing everything on deactivate keeps this tab's overlays out of sight
  // (and out of the way) whenever it isn't the one showing.
  useEffect(() => {
    if (!isActive) {
      setShowAdd(false);
      setDetail(null);
      setEditing(false);
      setPopup(null);
    }
  }, [isActive]);

  // ---- Realtime sync ----
  // Mirrors FeesTab's pattern: a dedicated channel on `enquiries` patches
  // local state as rows change on any device, so the list (and any open
  // detail card) stays live without a manual refetch after every action.
  useEffect(() => {
    if (!academyId) return;

    const channel = supabase
      .channel(`enquiries-${academyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries', filter: `academy_id=eq.${academyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old;
            if (!oldRow) return;
            setEnquiries(prev => prev.filter(q => q.id !== oldRow.id));
            setDetail(d => (d && d.id === oldRow.id ? null : d));
            setEnquiryCount(c => Math.max(0, c - 1));
          } else {
            const row = payload.new;
            if (!row) return;
            setEnquiries(prev => {
              const idx = prev.findIndex(q => q.id === row.id);
              if (idx === -1) return [row, ...prev];
              const next = prev.slice();
              next[idx] = row;
              return next;
            });
            setDetail(d => (d && d.id === row.id ? { ...d, ...row } : d));
            if (payload.eventType === 'INSERT') setEnquiryCount(c => c + 1);
          }
        })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [academyId]);

  const logEnquiry = async (message) => {
    try {
      const { error } = await supabase.from('audit_log').insert({
        academy_id: academyId, user_id: createdByName, role: isAdmin ? 'admin' : 'staff', action: message, detail: message,
      });
      if (error) console.error('audit_log insert failed (enquiry):', error);
    } catch (e) { console.error('audit_log insert threw (enquiry):', e); }
  };

  const staffScopedSports = useMemo(() => visibleSports.map(s => s.name), [visibleSports]);

  const activeFilterCount = [filterConv, filterSport, filterReminder, isAdmin ? filterStaff : ''].filter(Boolean).length;

  const filtered = useMemo(() => {
    let list = enquiries.filter(q => (view === 'archive' ? q.archived : !q.archived));

    if (!isAdmin) {
      list = list.filter(q => q.assigned_to === appUser?.id || q.created_by === createdByName || q.created_by === appUser?.id);
    }

    const s = search.trim().toLowerCase();
    if (s) list = list.filter(q => (q.name || '').toLowerCase().includes(s) || (q.phone || '').toLowerCase().includes(s));
    if (filterConv) list = list.filter(q => q.conversion_ratio === filterConv);
    if (filterSport) list = list.filter(q => (q.sport || '') === filterSport);
    if (filterReminder) list = list.filter(q => q.reminder_date === filterReminder);
    if (isAdmin && filterStaff) {
      list = filterStaff === '__UNASSIGNED__'
        ? list.filter(q => !q.assigned_to)
        : list.filter(q => q.assigned_to === filterStaff);
    }

    return [...list].sort((a, b) => {
      const ar = a.reminder_date || '', br = b.reminder_date || '';
      if (ar && !br) return -1;
      if (!ar && br) return 1;
      if (ar && br) return ar.localeCompare(br);
      return 0;
    });
  }, [enquiries, view, isAdmin, appUser, createdByName, search, filterConv, filterSport, filterReminder, filterStaff]);

  // ---- Add ----
  const openAdd = () => {
    if (atEnquiryLimit) return;
    setAddForm({ name: '', phone: '', query: '', location: '', sport: '', conversionRatio: '', reminderDate: '', assignedTo: '' });
    setAddError('');
    setShowAdd(true);
  };

  // Focus the Name field (opens the keyboard on mobile) once the add form has mounted
  useEffect(() => {
    if (showAdd) {
      const t = setTimeout(() => nameInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [showAdd]);

  const saveEnquiry = async () => {
    if (atEnquiryLimit) {
      setAddError(`Limit reached (${limits.enquiries} enquiries) on your ${plan?.name || 'current'} plan.`);
      return;
    }
    if (!addForm.name.trim()) { setAddError('Name is required.'); return; }
    if (addForm.phone && !isValidPhone(addForm.phone)) { setAddError('Phone must be a 10-digit number.'); return; }
    setAddError('');
    const row = {
      academy_id: academyId,
      name: addForm.name.trim(),
      phone: addForm.phone ? normalizePhone(addForm.phone) : '',
      query: addForm.query || '',
      location: addForm.location || '',
      conversion_ratio: addForm.conversionRatio || '',
      sport: addForm.sport || '',
      reminder_date: addForm.reminderDate || null,
      assigned_to: addForm.assignedTo || '',
      created_by: createdByName,
      archived: false,
      edit_history: [],
      staff_notes: [],
    };
    const { error } = await supabase.from('enquiries').insert(row);
    if (error) { setAddError(error.message); return; }
    logEnquiry(`Added query for ${row.name}`);
    setShowAdd(false);
  };

  // ---- Detail / edit ----
  const openDetail = (q) => { setDetail(q); setEditing(false); setNoteDraft(''); };
  const closeDetail = () => { setDetail(null); setEditing(false); };

  // Keep the notes window pinned to the latest note whenever the detail opens or notes change
  useEffect(() => {
    if (detail && notesScrollRef.current) {
      notesScrollRef.current.scrollTop = notesScrollRef.current.scrollHeight;
    }
  }, [detail?.id, detail?.staff_notes]);

  const startEdit = () => {
    setEditForm({
      name: detail.name || '', phone: detail.phone || '', query: detail.query || '',
      location: detail.location || '', conversionRatio: detail.conversion_ratio || '',
      sport: detail.sport || '', assignedTo: detail.assigned_to || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editForm.name.trim()) return;
    if (editForm.phone && !isValidPhone(editForm.phone)) { window.alert('Phone must be a 10-digit number.'); return; }
    const history = Array.isArray(detail.edit_history) ? detail.edit_history : [];
    const patch = {
      name: editForm.name.trim(), phone: editForm.phone ? normalizePhone(editForm.phone) : '',
      query: editForm.query, location: editForm.location, conversion_ratio: editForm.conversionRatio,
      sport: editForm.sport, assigned_to: isAdmin ? editForm.assignedTo : detail.assigned_to,
      edit_history: [...history, { by: createdByName, at: new Date().toISOString() }],
    };
    const { error } = await supabase.from('enquiries').update(patch).eq('id', detail.id);
    if (error) { window.alert(error.message); return; }
    logEnquiry(`Edited query for ${patch.name}`);
    setEditing(false);
    setDetail(d => ({ ...d, ...patch }));
  };

  const saveReminder = async (newDate) => {
    await supabase.from('enquiries').update({ reminder_date: newDate || null }).eq('id', detail.id);
    logEnquiry(`Reminder date updated for ${detail.name}${newDate ? ` → ${newDate}` : ' (cleared)'}`);
    setDetail(d => ({ ...d, reminder_date: newDate || null }));
  };

  const saveNote = async () => {
    const note = noteDraft.trim();
    if (!note) return;
    const notes = Array.isArray(detail.staff_notes) ? detail.staff_notes : [];
    const updated = [...notes, { by: createdByName, at: new Date().toISOString(), note }];
    await supabase.from('enquiries').update({ staff_notes: updated }).eq('id', detail.id);
    logEnquiry(`Note added to query for ${detail.name} by ${createdByName}`);
    setDetail(d => ({ ...d, staff_notes: updated }));
    setNoteDraft('');
  };

  const toggleArchive = async () => {
    const goingToArchive = !detail.archived;
    await supabase.from('enquiries').update({ archived: goingToArchive, archived_at: goingToArchive ? new Date().toISOString() : null }).eq('id', detail.id);
    logEnquiry(`${goingToArchive ? 'Archived' : 'Restored'} query for ${detail.name}`);
    closeDetail();
  };

  const removeEnquiry = async () => {
    if (!window.confirm(`Delete this query for ${detail.name}? This cannot be undone.`)) return;
    const id = detail.id;
    await supabase.from('enquiries').delete().eq('id', id);
    logEnquiry(`Deleted query for ${detail.name}`);
    // Don't wait on the realtime round-trip for our own delete — remove it
    // locally right away. Realtime will just re-confirm (or no-op) for us,
    // and still handles it for other open tabs/devices.
    setEnquiries(prev => prev.filter(q => q.id !== id));
    setEnquiryCount(c => Math.max(0, c - 1));
    closeDetail();
  };

  const startConvert = () => {
    setConvertingEnqId(detail.id);
    setConvertPrefill({ name: detail.name, contact: detail.phone, parent: detail.name, sport: detail.sport });
    closeDetail();
  };

  const onConverted = async () => {
    const id = convertingEnqId;
    setConvertPrefill(null);
    setConvertingEnqId(null);
    if (id) {
      const q = enquiries.find(e => e.id === id);
      await supabase.from('enquiries').delete().eq('id', id);
      logEnquiry(`Converted query to student: "${q?.name || ''}"`);
      setEnquiries(prev => prev.filter(e => e.id !== id));
      setEnquiryCount(c => Math.max(0, c - 1));
    }
  };

  const assignedName = (userId) => {
    const u = staffList.find(x => x.id === userId);
    return u ? (u.name || u.id) : '';
  };

  const inputStyle = 'form-input';

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{EQ_CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <div className="section-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SheetIcon name="messages" size={19} /> Enquiries
        </div>
        <div role="group" aria-label="Enquiry view" style={{ display: 'flex', alignItems: 'stretch', height: 30, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--card, #fff)', flexShrink: 0 }}>
          <button
            type="button"
            className="eq-seg"
            aria-pressed={view === 'active'}
            onClick={() => setView('active')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', fontSize: 11.5, fontWeight: 700, border: 'none', cursor: 'pointer', background: view === 'active' ? 'var(--accent2)' : 'transparent', color: view === 'active' ? '#fff' : 'var(--gray)' }}
          >Active</button>
          <button
            type="button"
            className="eq-seg"
            aria-pressed={view === 'archive'}
            onClick={() => setView('archive')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 12px', fontSize: 11.5, fontWeight: 700, border: 'none', cursor: 'pointer', background: view === 'archive' ? 'var(--accent2)' : 'transparent', color: view === 'archive' ? '#fff' : 'var(--gray)' }}
          ><SheetIcon name="archive" size={13} /> Archive</button>
        </div>
      </div>

      {atEnquiryLimit && (
        <div style={{ fontSize: 11.5, color: '#dc2626', background: '#dc262622', border: '1px solid #dc262644', borderRadius: 8, padding: '7px 10px', marginBottom: 8 }}>
          Limit reached ({limits.enquiries} enquiries) on your <strong>{plan?.name}</strong> plan.
          {(() => { const t = nextPlanForLimit('enquiries'); return t ? <> Upgrade to <strong>{t.name}</strong> for more.</> : null; })()}
        </div>
      )}

      {/* Filter panel — collapsible card, matching AttendanceTab's date/filter panel */}
      <div className="card" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={() => setPanelOpen(p => !p)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13.5 }}>
              <span style={{ display: 'flex', color: 'var(--accent2)' }}><SheetIcon name="funnel" size={15} /></span> Filters
            </span>
            {activeFilterCount > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: 'var(--accent2)', color: '#fff' }}>{activeFilterCount}</span>
            )}
          </div>
          <button className="arrow-btn eq-iconbtn" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            aria-label={panelOpen ? 'Collapse filters' : 'Expand filters'} aria-expanded={panelOpen}
            onClick={(e) => { e.stopPropagation(); setPanelOpen(p => !p); }}>
            <SheetIcon name={panelOpen ? 'chevronUp' : 'chevronDown'} size={15} />
          </button>
        </div>

        {panelOpen && (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button className="btn btn-outline btn-sm" style={{ fontSize: 12, padding: '7px 9px', minHeight: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setPopup('conv')}>
              {CONVERSION_OPTIONS.find(o => o.value === filterConv)?.label || 'All Conversion'}
            </button>
            <button className="btn btn-outline btn-sm" style={{ fontSize: 12, padding: '7px 9px', minHeight: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setPopup('sport')}>
              {filterSport || 'All Sports'}
            </button>
            {isAdmin && (
              <button className="btn btn-outline btn-sm" style={{ fontSize: 12, padding: '7px 9px', minHeight: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setPopup('staff')}>
                {filterStaff === '__UNASSIGNED__' ? '— Unassigned —' : (staffList.find(u => u.id === filterStaff)?.name || staffList.find(u => u.id === filterStaff)?.id) || 'Assigned to: All'}
              </button>
            )}
            <input type="date" className="form-input" aria-label="Filter by reminder date" style={{ fontSize: 12, padding: '7px 9px', minHeight: 36 }} value={filterReminder} onChange={e => setFilterReminder(e.target.value)} />
          </div>
        )}
      </div>

      {popup === 'conv' && (
        <FilterPopup title="Filter by Conversion" onClose={() => setPopup(null)}>
          <RadioRow name="convsel" checked={!filterConv} onChange={() => { setFilterConv(''); setPopup(null); }} label="All Conversion" />
          {CONVERSION_OPTIONS.map(o => (
            <RadioRow key={o.value} name="convsel" checked={filterConv === o.value} onChange={() => { setFilterConv(o.value); setPopup(null); }} label={o.label} />
          ))}
        </FilterPopup>
      )}

      {popup === 'sport' && (
        <FilterPopup title="Filter by Sport" onClose={() => setPopup(null)}>
          <RadioRow name="sportsel" checked={!filterSport} onChange={() => { setFilterSport(''); setPopup(null); }} label="All Sports" />
          {(isAdmin ? visibleSports.map(s => s.name) : staffScopedSports).map(sp => (
            <RadioRow key={sp} name="sportsel" checked={filterSport === sp} onChange={() => { setFilterSport(sp); setPopup(null); }} label={sp} />
          ))}
        </FilterPopup>
      )}

      {popup === 'staff' && isAdmin && (
        <FilterPopup title="Filter by Assigned Staff" onClose={() => setPopup(null)}>
          <RadioRow name="staffsel" checked={!filterStaff} onChange={() => { setFilterStaff(''); setPopup(null); }} label="Assigned to: All" />
          {staffList.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)).map(u => (
            <RadioRow key={u.id} name="staffsel" checked={filterStaff === u.id} onChange={() => { setFilterStaff(u.id); setPopup(null); }} label={`${u.name || u.id}${u.role?.includes('admin') ? ' (Admin)' : ''}`} />
          ))}
          <RadioRow name="staffsel" checked={filterStaff === '__UNASSIGNED__'} onChange={() => { setFilterStaff('__UNASSIGNED__'); setPopup(null); }} label="— Unassigned —" />
        </FilterPopup>
      )}

      <div className="search-wrap" style={{ marginBottom: 8 }}>
        <SheetIcon name="search" size={15} />
        <input type="text" className="search-input" aria-label="Search enquiries by name or phone" placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button type="button" className="search-clear-btn eq-iconbtn" onClick={() => setSearch('')} aria-label="Clear search" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SheetIcon name="x" size={14} /></button>}
      </div>


      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>
        {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20, fontSize: 12 }}>Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30, fontSize: 13 }}>
            {view === 'archive' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SheetIcon name="archive" size={15} /> No archived queries.</span> : (isAdmin ? <>No queries match your filters.<br />Tap the <b>+</b> button to record one.</> : 'No queries assigned to you yet.')}
          </div>
        )}
        {filtered.map(q => {
          const today = todayIso();
          const isOverdue = q.reminder_date && q.reminder_date < today;
          const noteCount = (q.staff_notes || []).length;
          return (
            <div key={q.id} onClick={() => openDetail(q)} className="card hover-lift eq-card"
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(q); } }}
              style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', border: '1px solid var(--border)', boxSizing: 'border-box', maxWidth: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
                <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {(q.name || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 6px' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{q.name}</span>
                    <ConversionBadge ratio={q.conversion_ratio} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--accent2)', marginTop: 2, minWidth: 0 }}>
                    <SheetIcon name="phone" size={12} stroke={2.2} /> <span style={{ overflowWrap: 'anywhere' }}>{q.phone || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                    {q.reminder_date && (
                      <MetaChip icon="calendarClock" tone={isOverdue ? 'danger' : 'info'}>
                        {q.reminder_date}{isOverdue ? ' · overdue' : ''}
                      </MetaChip>
                    )}
                    {q.assigned_to
                      ? <MetaChip icon="userRound">{assignedName(q.assigned_to)}</MetaChip>
                      : (isAdmin && <MetaChip icon="userRound">Unassigned</MetaChip>)}
                    {noteCount > 0 && <MetaChip icon="notebookPen">{noteCount} note{noteCount > 1 ? 's' : ''}</MetaChip>}
                    {isAdmin && q.created_by && <MetaChip icon="userCheck">{q.created_by}</MetaChip>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray)', flexShrink: 0, whiteSpace: 'nowrap', paddingTop: 2 }}>{relTime(q.created_at)}</div>
            </div>
          );
        })}
      </div>

      {isActive && !showAdd && !detail && createPortal(
        <button
          onClick={openAdd}
          disabled={atEnquiryLimit}
          className="eq-fab"
          aria-label={atEnquiryLimit ? 'Enquiry limit reached' : 'Add enquiry'}
          title={atEnquiryLimit ? `Limit reached (${limits.enquiries} enquiries) on ${plan?.name} plan` : 'Add enquiry'}
          style={{
            position: 'fixed',
            right: 'max(18px, env(safe-area-inset-right, 0px))',
            bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
            width: 54,
            height: 54,
            padding: 0,
            borderRadius: '50%',
            background: atEnquiryLimit ? 'var(--gray)' : 'var(--accent2)',
            color: '#fff',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(26,51,106,.25)',
            cursor: atEnquiryLimit ? 'not-allowed' : 'pointer',
            opacity: atEnquiryLimit ? 0.6 : 1,
            zIndex: 500,
          }}
        >
          <SheetIcon name="plus" size={26} stroke={2.4} />
        </button>,
        document.body
      )}

      {isActive && showAdd && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 62, background: 'rgba(10,20,40,.55)', zIndex: 250, display: 'flex', alignItems: 'flex-end' }} onClick={() => setShowAdd(false)}>
          <div
            className="eq-sheet"
            role="dialog" aria-modal="true" aria-label="New enquiry"
            style={{
              width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '100%', overflowY: 'auto', overscrollBehavior: 'contain',
              background: 'var(--card, #fff)', border: '1px solid var(--border)', borderBottom: 'none',
              borderRadius: '16px 16px 0 0', boxShadow: '0 -6px 20px rgba(10,20,40,.16)',
              padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box',
            }}
            onClick={e => e.stopPropagation()}
          >
            <style>{SHEET_CSS}</style>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(91,124,196,.12)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SheetIcon name="messages" size={18} /></span>
                <div style={{ fontWeight: 700, fontSize: 17, color: '#182238', lineHeight: 1.2 }}>New Query</div>
              </div>
              <button type="button" className="eq-btn" onClick={() => setShowAdd(false)} aria-label="Close new enquiry"
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
                <SheetIcon name="x" size={16} />
              </button>
            </div>
            {addError && (
              <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
                <span style={{ display: 'flex', marginTop: 1 }}><SheetIcon name="alertCircle" size={15} /></span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{addError}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="userRound" size={13} /> Name *</span>}><input ref={nameInputRef} className={inputStyle} style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} /></Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="phone" size={13} /> Phone</span>}><input className={inputStyle} style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} type="tel" inputMode="numeric" maxLength={10} value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: normalizePhone(e.target.value).slice(0, 10) }))} placeholder="10-digit mobile number" /></Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="mapPin" size={13} /> Location / Area</span>}><input className={inputStyle} style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.location} onChange={e => setAddForm(f => ({ ...f, location: e.target.value }))} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 10 }}>
                {isAdmin && (
                  <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="userCheck" size={13} /> Assign to Staff</span>}>
                    <select className="form-select" style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.assignedTo} onChange={e => setAddForm(f => ({ ...f, assignedTo: e.target.value }))}>
                      <option value="">— Unassigned —</option>
                      {staffList.map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                    </select>
                  </Field>
                )}
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="medal" size={13} /> Sport of interest</span>}>
                  <select className="form-select" style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.sport} onChange={e => setAddForm(f => ({ ...f, sport: e.target.value }))}>
                    <option value="">Not specified</option>
                    {visibleSports.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="flame" size={13} /> Conversion Ratio</span>}>
                  <select className="form-select" style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.conversionRatio} onChange={e => setAddForm(f => ({ ...f, conversionRatio: e.target.value }))}>
                    <option value="">Select…</option>
                    {CONVERSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="calendarClock" size={13} /> Next Reminder</span>}><input type="date" className={inputStyle} style={{ height: 40, boxSizing: 'border-box', background: '#fff' }} value={addForm.reminderDate} onChange={e => setAddForm(f => ({ ...f, reminderDate: e.target.value }))} /></Field>
              </div>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1A336A' }}><SheetIcon name="fileText" size={13} /> Query / Interest</span>}><textarea className={inputStyle} rows={3} style={{ resize: 'none', boxSizing: 'border-box', background: '#fff' }} value={addForm.query} onChange={e => setAddForm(f => ({ ...f, query: e.target.value }))} placeholder="What are they enquiring about?" /></Field>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-outline eq-btn" style={{ flex: 1, minHeight: 44, borderRadius: 12, color: '#1A336A', fontWeight: 600 }} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="button" className="btn eq-btn" style={{ flex: 1.4, minHeight: 44, borderRadius: 12, background: '#1A336A', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={saveEnquiry}><SheetIcon name="save" size={16} /> Save Query</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isActive && detail && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 62, background: 'rgba(10,20,40,.55)', zIndex: 250, display: 'flex', alignItems: 'flex-end' }} onClick={closeDetail}>
          <div
            className="eq-sheet"
            role="dialog" aria-modal="true" aria-label="Enquiry details"
            style={{
              width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '100%', overflowY: 'auto', overscrollBehavior: 'contain',
              background: 'var(--card, #fff)', border: '1px solid var(--border)', borderBottom: 'none',
              borderRadius: '16px 16px 0 0', boxShadow: '0 -6px 20px rgba(10,20,40,.16)',
              padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box',
            }}
            onClick={e => e.stopPropagation()}
          >
            <style>{SHEET_CSS}</style>
            {!editing ? (
              <>
                {/* Contact header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
                      <span style={{ fontWeight: 700, fontSize: 17, color: '#182238', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{detail.name}</span>
                      <ConversionBadge ratio={detail.conversion_ratio} />
                    </div>
                    {detail.phone && (
                      <a href={`tel:${detail.phone}`} aria-label={`Call ${detail.name} at ${detail.phone}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, fontSize: 13.5, fontWeight: 500, color: '#1A336A', textDecoration: 'none' }}>
                        <SheetIcon name="phone" size={14} /> {detail.phone}
                      </a>
                    )}
                  </div>
                  <button type="button" className="eq-btn" onClick={closeDetail} aria-label="Close enquiry details"
                    style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
                    <SheetIcon name="x" size={16} />
                  </button>
                </div>

                {/* Description */}
                {detail.query && (
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#182238', background: 'rgba(91,124,196,.08)', border: '1px solid rgba(91,124,196,.16)', borderRadius: 10, padding: '9px 11px', marginBottom: 10, overflowWrap: 'anywhere' }}>
                    {detail.query}
                  </div>
                )}

                {/* Metadata */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13, marginBottom: 12 }}>
                  {[
                    detail.location && { icon: 'mapPin', label: 'Location', value: detail.location },
                    detail.sport && { icon: 'medal', label: 'Sport', value: detail.sport },
                    isAdmin && { icon: 'userRound', label: 'Assigned to', value: detail.assigned_to ? assignedName(detail.assigned_to) : null, empty: 'Unassigned' },
                    detail.created_by && { icon: 'userCheck', label: 'Added by', value: detail.created_by },
                  ].filter(Boolean).map(m => (
                    <div key={m.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                      <span style={{ display: 'flex', color: '#5B7CC4', marginTop: 2 }}><SheetIcon name={m.icon} size={15} /></span>
                      <span style={{ color: 'var(--gray)', width: 82, flexShrink: 0 }}>{m.label}</span>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: m.value ? 600 : 500, color: m.value ? '#182238' : 'var(--gray)' }}>{m.value || m.empty}</span>
                    </div>
                  ))}
                </div>

                {/* Next reminder date */}
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="eq-reminder" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 5 }}>
                    <SheetIcon name="calendar" size={14} /> Next Reminder Date
                  </label>
                  <input id="eq-reminder" type="date" className="form-input" style={{ height: 40, background: '#fff', boxSizing: 'border-box' }} defaultValue={detail.reminder_date || ''} onBlur={e => { if (e.target.value !== (detail.reminder_date || '')) saveReminder(e.target.value); }} />
                </div>

                {/* Staff notes */}
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="eq-note" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 5 }}>
                    <SheetIcon name="fileText" size={14} /> Staff Notes {(detail.staff_notes || []).length > 0 && `(${detail.staff_notes.length})`}
                  </label>
                  {(detail.staff_notes || []).length > 0 && (
                    <div
                      ref={notesScrollRef}
                      style={{
                        maxHeight: 160,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        marginBottom: 8,
                        padding: 2,
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                      }}
                    >
                      {detail.staff_notes.map((n, i) => (
                        <div key={i} style={{ fontSize: 12, background: 'var(--card2)', borderRadius: 6, padding: '6px 9px', overflowWrap: 'anywhere' }}>
                          <div>{n.note}</div>
                          <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>{n.by} · {relTime(n.at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                    <input id="eq-note" className="form-input" style={{ flex: 1, minWidth: 0, height: 40, background: '#fff', boxSizing: 'border-box' }} placeholder="Add a note…" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveNote(); }} />
                    <button type="button" className="btn btn-outline btn-sm eq-btn" style={{ height: 40, padding: '0 16px', borderRadius: 10, flexShrink: 0, color: '#1A336A', fontWeight: 600 }} onClick={saveNote}>Add</button>
                  </div>
                </div>

                {isAdmin && (detail.edit_history || []).length > 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--gray)', marginBottom: 10 }}>
                    Last edited by {detail.edit_history[detail.edit_history.length - 1].by} · {relTime(detail.edit_history[detail.edit_history.length - 1].at)}
                  </div>
                )}

                {/* Primary action */}
                {isAdmin && !detail.archived && (
                  <button type="button" className="btn eq-btn" onClick={startConvert}
                    style={{ width: '100%', minHeight: 44, marginBottom: 8, borderRadius: 12, background: '#1A336A', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <SheetIcon name="users" size={17} /> Convert to Student
                  </button>
                )}

                {/* Secondary actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline eq-btn" onClick={startEdit}
                    style={{ flex: 1, minHeight: 42, borderRadius: 10, color: '#1A336A', border: '1px solid var(--border)', background: '#fff', fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    <SheetIcon name="pencil" size={15} /> Edit
                  </button>
                  <button type="button" className="btn btn-outline eq-btn" onClick={toggleArchive}
                    style={{ flex: 1, minHeight: 42, borderRadius: 10, color: '#1A336A', border: '1px solid var(--border)', background: '#fff', fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    <SheetIcon name={detail.archived ? 'archiveRestore' : 'archive'} size={15} /> {detail.archived ? 'Restore' : 'Archive'}
                  </button>
                </div>

                {/* Destructive action — visually separated */}
                {isAdmin && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                    <button type="button" className="btn eq-btn" onClick={removeEnquiry}
                      style={{ width: '100%', minHeight: 42, borderRadius: 10, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                      <SheetIcon name="trash" size={15} /> Delete Query
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#182238' }}><SheetIcon name="pencil" size={17} /> Edit Query</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Field label="Name"><input className={inputStyle} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></Field>
                  <Field label="Phone"><input className={inputStyle} maxLength={10} value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: normalizePhone(e.target.value).slice(0, 10) }))} /></Field>
                  <Field label="Query / Interest"><textarea className={inputStyle} rows={3} style={{ resize: 'none' }} value={editForm.query} onChange={e => setEditForm(f => ({ ...f, query: e.target.value }))} /></Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Location"><input className={inputStyle} value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} /></Field>
                    <Field label="Conversion Ratio">
                      <select className="form-select" value={editForm.conversionRatio} onChange={e => setEditForm(f => ({ ...f, conversionRatio: e.target.value }))}>
                        <option value="">Select…</option>
                        {CONVERSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Sport">
                    <select className="form-select" value={editForm.sport} onChange={e => setEditForm(f => ({ ...f, sport: e.target.value }))}>
                      <option value="">Not specified</option>
                      {visibleSports.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </Field>
                  {isAdmin && (
                    <Field label="Assign to Staff">
                      <select className="form-select" value={editForm.assignedTo} onChange={e => setEditForm(f => ({ ...f, assignedTo: e.target.value }))}>
                        <option value="">— Unassigned —</option>
                        {staffList.map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                      </select>
                    </Field>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary" style={{ flex: 1.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }} onClick={saveEdit}><SheetIcon name="save" size={16} /> Save Changes</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {convertPrefill && (
        <AddStudentModal
          academyId={academyId}
          sports={visibleSports}
          batches={visibleBatches}
          initial={convertPrefill}
          existingStudents={[]}
          onClose={() => { setConvertPrefill(null); setConvertingEnqId(null); }}
          onSaved={onConverted}
        />
      )}
    </div>
  );
}
