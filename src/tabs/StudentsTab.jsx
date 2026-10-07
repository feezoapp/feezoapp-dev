import { useEffect, useMemo, useRef, useState } from 'react';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import LimitGatedButton from '../components/LimitGatedButton';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import AddStudentModal from '../components/AddStudentModal';
import StudentDetailModal from '../components/StudentDetailModal';
import ImportStudentsModal from '../components/ImportStudentsModal';
import BulkEditStudentsModal from '../components/BulkEditStudentsModal';
import { exportStudentsPdf, exportStudentsXlsx } from '../lib/exporters';

// Natural sort for roll numbers like "SM1", "SM2", "SM10" — plain string
// comparison would wrongly put "SM10" before "SM2". This splits into the
// letter prefix and numeric part and compares the number numerically.
function compareRollNo(a, b) {
  const ra = String(a || '');
  const rb = String(b || '');
  const pa = ra.match(/^(\D*)(\d*)/);
  const pb = rb.match(/^(\D*)(\d*)/);
  const prefixCmp = (pa[1] || '').localeCompare(pb[1] || '');
  if (prefixCmp !== 0) return prefixCmp;
  const na = pa[2] ? parseInt(pa[2], 10) : NaN;
  const nb = pb[2] ? parseInt(pb[2], 10) : NaN;
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return ra.localeCompare(rb);
}

// Long-press helper: hold a row ~600ms to trigger onLongPress; a normal tap
// calls onTap. Moving the finger >10px (scrolling) cancels the hold, and the
// click that follows a completed long press is swallowed.
function useLongPress(onLongPress, onTap, ms = 600) {
  const timer = useRef(null);
  const fired = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const clear = () => { clearTimeout(timer.current); timer.current = null; };

  return (item) => ({
    onPointerDown: (e) => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        navigator.vibrate?.(30);
        onLongPress(item);
      }, ms);
    },
    onPointerMove: (e) => {
      if (timer.current &&
          Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e) => e.preventDefault(),
    onClick: () => {
      if (fired.current) { fired.current = false; return; }
      onTap(item);
    },
  });
}

// ---------------------------------------------------------------------------
// Presentation-only helpers (icons, styles). No data or business logic here.
// ---------------------------------------------------------------------------

// One consistent outline icon set (Lucide-style: 24px grid, round caps/joins,
// same stroke weight everywhere). Colour follows the parent's text colour.
const ICONS = {
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  upload: <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 17v3h16v-3" /></>,
  search: <><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  arrowUp: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  edit: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  squareCheck: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m9 12 2 2 4-4" /></>,
  squareX: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  fileText: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  sheet: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M8 13h2" /><path d="M14 13h2" /><path d="M8 17h2" /><path d="M14 17h2" /></>,
};

function Icon({ name, size = 18, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}>
      {ICONS[name]}
    </svg>
  );
}

// Scoped styles for hover / press / focus states and small transitions, which
// inline styles can't express. Every class is prefixed `st-`.
const STUDENTS_CSS = `
.st-btn{transition:transform .12s ease,background-color .15s ease,border-color .15s ease,box-shadow .15s ease,opacity .15s ease}
.st-btn:active:not(:disabled){transform:scale(.95)}
.st-btn:disabled{cursor:not-allowed}
.st-btn:focus-visible,.st-list .st-card:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.st-round:hover:not(:disabled){background:#0B3358}
.st-chip:hover{border-color:#9DB2DD}
.st-search{transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.st-search:focus{border-color:#5B7CC4 !important;box-shadow:0 0 0 3px rgba(91,124,196,.18);background:#fff !important}
.st-list .st-card{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:46px;margin-bottom:6px;cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(16,32,64,.04);transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease,transform .12s ease;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y}
@media (hover:hover){.st-list .st-card:hover{border-color:#B9C7E6;box-shadow:0 2px 8px rgba(16,32,64,.08)}}
.st-list .st-card:active{transform:scale(.995)}
.st-list .st-card.is-sel{background:rgba(91,124,196,.10);border-color:#5B7CC4;box-shadow:0 0 0 1px #5B7CC4}
.st-list .st-card.is-drop{background:rgba(220,38,38,.04);border-color:rgba(220,38,38,.22)}
.st-list .st-card.is-drop.is-sel{background:rgba(220,38,38,.09);border-color:#ef4444;box-shadow:0 0 0 1px #ef4444}
@keyframes st-fade{from{opacity:0}to{opacity:1}}
@keyframes st-pop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.st-overlay{animation:st-fade .15s ease}
.st-sheet,.st-bar{animation:st-pop .16s ease}
@media (prefers-reduced-motion:reduce){.st-btn,.st-card,.st-search,.st-overlay,.st-sheet,.st-bar{animation:none !important;transition:none !important}}
`;

const SORT_OPTIONS = [
  { v: 'roll_asc', l: 'Roll No · Ascending', short: 'Roll No', dir: 'arrowUp' },
  { v: 'roll_desc', l: 'Roll No · Descending', short: 'Roll No', dir: 'arrowDown' },
  { v: 'name_az', l: 'Name A–Z', short: 'Name', dir: 'arrowUp' },
  { v: 'name_za', l: 'Name Z–A', short: 'Name', dir: 'arrowDown' },
];

function RollBadge({ rollNo }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 38, height: 22, padding: '0 8px', borderRadius: 7,
      background: 'var(--accent2)', color: '#fff', fontSize: 11.5, fontWeight: 700,
      letterSpacing: '.01em', flexShrink: 0,
    }}>
      {rollNo || '+Roll'}
    </span>
  );
}

// Right-hand end of a student row: chevron normally; in select mode a round
// check indicator (replaces the old checkbox) so selection state is obvious.
function RowTail({ selectMode, on, tone = 'blue' }) {
  if (!selectMode) {
    return <span style={{ display: 'flex', color: 'var(--gray)', flexShrink: 0 }}><Icon name="chevronRight" size={18} /></span>;
  }
  const c = tone === 'red' ? '#ef4444' : '#1A336A';
  return (
    <span style={{
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: on ? c : 'transparent', border: `1.5px solid ${on ? c : '#B4BED3'}`, color: '#fff',
      transition: 'background-color .15s ease, border-color .15s ease',
    }}>
      {on && <Icon name="check" size={13} stroke={3} />}
    </span>
  );
}

// Popup shell shared by the Sport / Batch / Sort / Download pickers. Callers
// still pass the same title / onClose / children.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      className="st-overlay"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        className="st-sheet"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: '14px 12px 10px', width: '100%', maxWidth: 320,
          maxHeight: '72vh', overflowY: 'auto', boxShadow: '0 12px 32px rgba(10,18,35,.24)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 6, padding: '0 4px' }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A336A', textAlign: 'center' }}>{title}</div>
          <button
            className="st-btn"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute', right: 0, width: 28, height: 28, borderRadius: '50%',
              background: '#F1F3F8', border: 'none', color: '#6B7385',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, minHeight: 44,
        padding: '10px 10px', borderRadius: 10, cursor: 'pointer', margin: '2px 0',
        background: checked ? 'rgba(91,124,196,.12)' : 'transparent',
        color: checked ? '#1A336A' : '#333',
        fontWeight: checked ? 600 : 500,
        transition: 'background .15s ease, color .15s ease',
      }}
    >
      <input
        type="radio" name={name} checked={checked} onChange={onChange}
        style={{ width: 18, height: 18, accentColor: '#1A336A', flexShrink: 0, cursor: 'pointer' }}
      />
      {label}
    </label>
  );
}

// Subtle count badge in the header; also the Active / Dropped toggle.
function countPillStyle(active, tone) {
  const red = tone === 'red';
  return {
    fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 8, cursor: 'pointer', lineHeight: 1.4,
    border: `1px solid ${active ? (red ? '#ef4444' : '#1A336A') : (red ? 'rgba(220,38,38,.22)' : 'rgba(91,124,196,.28)')}`,
    background: active ? (red ? '#ef4444' : '#1A336A') : (red ? 'rgba(220,38,38,.07)' : 'rgba(91,124,196,.10)'),
    color: active ? '#fff' : (red ? '#DC2626' : '#1A336A'),
    whiteSpace: 'nowrap',
  };
}

// Sport / Batch / Sort chips — equal height, width and radius. A filter that
// is currently applied gets a light-blue highlight.
function filterChipStyle(on) {
  return {
    flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0,
    height: 36, fontSize: 12, fontWeight: 600, padding: '0 8px', borderRadius: 10,
    border: `1px solid ${on ? '#5B7CC4' : 'var(--border)'}`,
    background: on ? 'rgba(91,124,196,.10)' : 'var(--card2)', color: '#1A336A', cursor: 'pointer',
  };
}

// Round, icon-only header action (Download / Import).
const roundIconBtn = {
  width: 36, height: 36, borderRadius: '50%', border: 'none', padding: 0, flexShrink: 0,
  background: '#04213A', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 1px 3px rgba(4,33,58,.3)',
};

// Bulk-action buttons: secondary (All / None), primary (Edit / Restore), danger (Delete).
function bulkBtnStyle(kind, disabled) {
  const base = {
    minWidth: 0, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    fontSize: 11.5, fontWeight: 600, padding: '0 4px', borderRadius: 9, whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  };
  if (kind === 'primary') return { ...base, border: '1px solid #1A336A', background: '#1A336A', color: '#fff' };
  if (kind === 'danger') return { ...base, border: '1px solid var(--red)', background: 'var(--red)', color: '#fff' };
  return { ...base, border: '1px solid #C5D0EA', background: '#fff', color: '#1A336A' };
}

export default function StudentsTab() {
  const { visibleStudents, students, visibleSports, visibleBatches, refresh } = useAcademyData();
  const { isAdmin, academyId, appUser, canViewContactStudents, canExportStudents, canImportStudents, canViewStudents } = useAuth();
  const [search, setSearch] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [sortBy, setSortBy] = useState('roll_asc');
  const [popup, setPopup] = useState(null); // 'sport' | 'batch' | 'sort' | null
  const [selected, setSelected] = useState(new Set());
  const [showDownload, setShowDownload] = useState(false); // PDF / Excel chooser
  const [selectMode, setSelectMode] = useState(false); // turned on by long-pressing a student
  const [showAdd, setShowAdd] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'dropped' — toggled by the counter pills
  const [showImport, setShowImport] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [detailStudent, setDetailStudent] = useState(null);
  const [editStudent, setEditStudent] = useState(null);
  const searchInputRef = useRef(null);

  // Tapping/clicking the search field again while it already has text
  // selects the whole value instead of just dropping the cursor in — so
  // typing immediately replaces the previous query. No-op on an empty
  // field, so normal focus/typing behavior is unaffected.
  const selectAllOnTap = (e) => {
    if (e.target.value) e.target.select();
  };

  const filtered = useMemo(() => {
    let list = visibleStudents.filter(s => {
      if (sportFilter && !s.enrollments.some(en => en.sport === sportFilter)) return false;
      if (batchFilter && !s.enrollments.some(en => en.batch === batchFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(s.name?.toLowerCase().includes(q) || s.roll_no?.toLowerCase?.().includes(q))) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'roll_desc': return compareRollNo(b.roll_no, a.roll_no);
        case 'name_az': return (a.name || '').localeCompare(b.name || '');
        case 'name_za': return (b.name || '').localeCompare(a.name || '');
        default: return compareRollNo(a.roll_no, b.roll_no);
      }
    });
    return list;
  }, [visibleStudents, sportFilter, batchFilter, search, sortBy]);

  // Dropped (banned) students sink to the bottom under their own section.
  const activeList = useMemo(() => filtered.filter(s => !s.banned), [filtered]);
  const droppedList = useMemo(() => filtered.filter(s => s.banned), [filtered]);

  const batchesForSport = visibleBatches.filter(b => !sportFilter || b.sport === sportFilter);

  const selectSport = (sportName) => {
    setSportFilter(sportName);
    const firstBatch = visibleBatches.find(b => b.sport === sportName);
    setBatchFilter(sportName ? (firstBatch ? firstBatch.name : '') : '');
    setPopup(null);
  };

  // Active and Dropped are selected as two separate groups — selecting a
  // checkbox in one group clears whatever was selected in the other, so
  // "select all" / bulk actions never mix active with dropped students.
  const activeIdSet = useMemo(() => new Set(activeList.map(s => s.id)), [activeList]);
  const droppedIdSet = useMemo(() => new Set(droppedList.map(s => s.id)), [droppedList]);
  const selectedGroup = useMemo(() => {
    if (selected.size === 0) return null;
    for (const id of selected) { if (droppedIdSet.has(id)) return 'dropped'; }
    return 'active';
  }, [selected, droppedIdSet]);

  const toggleSelect = (id, group) => {
    setSelected(prev => {
      // Switching groups mid-selection: start a fresh selection in the new group.
      if (prev.size > 0 && selectedGroup && selectedGroup !== group) {
        return new Set([id]);
      }
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // Leave select mode (and hide the action bar) as soon as nothing is selected.
  useEffect(() => {
    if (selectMode && selected.size === 0) setSelectMode(false);
  }, [selectMode, selected]);

  const pressProps = useLongPress(
    (st) => { setSelectMode(true); setSelected(new Set([st.id])); },
    (st) => selectMode
      ? toggleSelect(st.id, st.banned ? 'dropped' : 'active')
      : setDetailStudent(st),
  );

  const selectAll = () => {
    const list = selectedGroup === 'dropped' ? droppedList : activeList;
    setSelected(new Set(list.map(s => s.id)));
  };

  const bulkDelete = async () => {
    if (!isAdmin) return; // UI already hides this from staff; guard kept in case of direct calls
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} student(s)?`)) return;
    const deletedNames = visibleStudents.filter(s => selected.has(s.id)).map(s => s.name || s.roll_no || s.id);
    await supabase.from('students').delete().in('id', Array.from(selected));
    exitSelectMode();
    refresh();
    logActivity({
      academyId, actorId: appUser?.id, actorName: appUser?.name, role: isAdmin ? 'admin' : 'staff',
      message: `Deleted ${deletedNames.length} student(s): ${deletedNames.join(', ')}`,
    });
  };

  const restoreSelected = async () => {
    if (!selected.size) return;
    setRestoring(true);
    const bannedOn = null;
    const restoredNames = visibleStudents.filter(s => selected.has(s.id)).map(s => s.name || s.roll_no || s.id);
    await supabase.from('students')
      .update({ banned: false, banned_on: bannedOn })
      .in('id', Array.from(selected));
    setRestoring(false);
    setShowRestoreConfirm(false);
    exitSelectMode();
    refresh();
    logActivity({
      academyId, actorId: appUser?.id, actorName: appUser?.name, role: isAdmin ? 'admin' : 'staff',
      message: `Restored ${restoredNames.length} dropped student(s): ${restoredNames.join(', ')}`,
    });
  };

  const selectedBatchLabel = batchesForSport.find(b => b.name === batchFilter)?.batchLabel;
  const selectedSortLabel = SORT_OPTIONS.find(o => o.v === sortBy)?.l;

  // Per-tab access gate — placed after all hooks above so Rules of Hooks
  // still holds; staff without the Students tab granted (see Staff Users)
  // see this instead of the roster.
  if (!canViewStudents) {
    return (
      <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', color: 'var(--gray)', marginBottom: 10 }}><Icon name="lock" size={32} stroke={1.75} /></div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Students</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  // Contact numbers are stripped from export data here rather than trusting
  // the export functions to omit them — canExport (download lists) and
  // canViewContact (see phone numbers) are separate, independently granted
  // permissions, so a staff member with export access but not contact
  // access must never get the number inside the downloaded file either.
  const stripContact = (list) => canViewContactStudents ? list : list.map(({ contact, ...rest }) => rest);

  // Keyboard access for rows (Enter / Space behave like a tap); pointer behaviour is unchanged.
  const rowProps = (st) => ({
    ...pressProps(st),
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressProps(st).onClick(); }
    },
  });
  const currentSort = SORT_OPTIONS.find(o => o.v === sortBy);
  const activeCount = visibleStudents.filter(s => !s.banned).length;
  const droppedCount = visibleStudents.filter(s => s.banned).length;
  const isFiltering = !!(sportFilter || batchFilter || search);

  return (
    <div className="page active st-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'inherit' }}>
      <style>{STUDENTS_CSS}</style>

      {/* Header: title + count badges on the left, Download / Import on the right */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '8px 12px', marginBottom: 6, boxShadow: '0 1px 2px rgba(16,32,64,.05)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap', rowGap: 4 }}>
            <span style={{ display: 'flex', color: '#1A336A' }}><Icon name="users" size={19} /></span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1A336A', letterSpacing: '-.01em', marginRight: 2 }}>Students</span>
            <button
              className="st-btn"
              aria-pressed={statusFilter === 'active'}
              onClick={() => setStatusFilter(f => f === 'active' ? 'all' : 'active')}
              style={countPillStyle(statusFilter === 'active', 'blue')}
            >
              {isFiltering ? `${activeList.length} active of ${activeCount}` : `${activeCount} active`}
            </button>
            {droppedCount > 0 && (
              <button
                className="st-btn"
                aria-pressed={statusFilter === 'dropped'}
                onClick={() => setStatusFilter(f => f === 'dropped' ? 'all' : 'dropped')}
                style={countPillStyle(statusFilter === 'dropped', 'red')}
              >
                {isFiltering ? `${droppedList.length} dropped of ${droppedCount}` : `${droppedCount} dropped`}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {canExportStudents && <button className="st-btn st-round" aria-label="Download students" title="Download" style={roundIconBtn} onClick={() => setShowDownload(true)}><Icon name="download" size={18} /></button>}
            {canImportStudents && <button className="st-btn st-round" aria-label="Import students" title="Import" style={roundIconBtn} onClick={() => setShowImport(true)}><Icon name="upload" size={18} /></button>}
          </div>
        </div>
      </div>

      {/* Search + filters */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 8, marginBottom: 6, boxShadow: '0 1px 2px rgba(16,32,64,.05)',
        display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 12, display: 'flex', color: 'var(--gray)', pointerEvents: 'none' }}>
            <Icon name="search" size={16} />
          </span>
          <input
            ref={searchInputRef}
            className="st-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={selectAllOnTap}
            onClick={selectAllOnTap}
            placeholder="Search by name or roll number"
            aria-label="Search students by name or roll number"
            style={{
              width: '100%', height: 38, padding: '0 38px 0 36px', boxSizing: 'border-box',
              borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card2)',
              fontSize: 13.5, fontWeight: 400, color: '#182238', outline: 'none', fontFamily: 'inherit',
            }}
          />
          {search && (
            <button type="button" className="st-btn" onClick={() => setSearch('')} aria-label="Clear search"
              style={{
                position: 'absolute', right: 7, width: 24, height: 24, borderRadius: '50%', border: 'none',
                background: 'var(--border)', color: 'var(--gray)', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
              <Icon name="x" size={13} stroke={2.4} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button className="st-btn st-chip" style={filterChipStyle(!!sportFilter)} onClick={() => setPopup('sport')} aria-haspopup="dialog" aria-label="Filter by sport">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sportFilter || 'All Sports'}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          <button className="st-btn st-chip" style={filterChipStyle(!!batchFilter)} onClick={() => setPopup('batch')} aria-haspopup="dialog" aria-label="Filter by batch">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBatchLabel || 'All Batches'}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          <button className="st-btn st-chip" style={filterChipStyle(false)} onClick={() => setPopup('sort')} aria-haspopup="dialog" aria-label={`Sort by ${currentSort?.l || ''}`}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentSort?.short || 'Sort'}</span>
            {currentSort && <span style={{ display: 'flex', color: '#5B7CC4' }}><Icon name={currentSort.dir} size={13} stroke={2.4} /></span>}
            <Icon name="chevronDown" size={14} />
          </button>
        </div>
      </div>

      {popup === 'sport' && (
        <FilterPopup title="Select Sport" onClose={() => setPopup(null)}>
          <RadioRow name="sportsel" checked={!sportFilter} onChange={() => selectSport('')} label="All Sports" />
          {visibleSports.map(s => (
            <RadioRow key={s.id} name="sportsel" checked={sportFilter === s.name} onChange={() => selectSport(s.name)} label={s.name} />
          ))}
        </FilterPopup>
      )}

      {popup === 'batch' && (
        <FilterPopup title="Select Batch" onClose={() => setPopup(null)}>
          <RadioRow name="batchsel" checked={!batchFilter} onChange={() => { setBatchFilter(''); setPopup(null); }} label="All Batches" />
          {batchesForSport.map(b => (
            <RadioRow key={b.id} name="batchsel" checked={batchFilter === b.name} onChange={() => { setBatchFilter(b.name); setPopup(null); }} label={b.batchLabel} />
          ))}
        </FilterPopup>
      )}

      {popup === 'sort' && (
        <FilterPopup title="Sort By" onClose={() => setPopup(null)}>
          {SORT_OPTIONS.map(o => (
            <RadioRow key={o.v} name="sortsel" checked={sortBy === o.v} onChange={() => { setSortBy(o.v); setPopup(null); }} label={o.l} />
          ))}
        </FilterPopup>
      )}

      {/* Bulk selection toolbar */}
      {selectMode && (
        <div className="st-bar" style={{
          background: 'rgba(91,124,196,.09)', border: '1px solid rgba(91,124,196,.35)',
          borderRadius: 12, padding: 8, marginBottom: 6, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, background: '#1A336A', color: '#fff',
              fontSize: 12, fontWeight: 600, padding: '4px 10px 4px 8px', borderRadius: 8,
            }}>
              <Icon name="check" size={14} stroke={2.6} />
              {selected.size} selected
            </span>
            <button
              className="st-btn"
              onClick={exitSelectMode}
              aria-label="Cancel selection"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, fontSize: 12, fontWeight: 600, padding: '0 10px', border: '1px solid #C5D0EA', borderRadius: 8, background: '#fff', color: '#1A336A', cursor: 'pointer' }}
            >
              <Icon name="x" size={14} /> Cancel
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'repeat(4, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            <button
              className="st-btn"
              onClick={selectAll}
              disabled={selected.size === (selectedGroup === 'dropped' ? droppedList.length : activeList.length)}
              style={bulkBtnStyle('secondary', selected.size === (selectedGroup === 'dropped' ? droppedList.length : activeList.length))}
            >
              <Icon name="squareCheck" size={15} /> All
            </button>
            <button
              className="st-btn"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              style={bulkBtnStyle('secondary', selected.size === 0)}
            >
              <Icon name="squareX" size={15} /> None
            </button>
            <button
              className="st-btn"
              onClick={() => selectedGroup === 'dropped' ? setShowRestoreConfirm(true) : setShowBulkEdit(true)}
              disabled={selected.size === 0}
              style={bulkBtnStyle('primary', selected.size === 0)}
            >
              <Icon name={selectedGroup === 'dropped' ? 'restore' : 'edit'} size={15} />
              {selectedGroup === 'dropped' ? 'Restore' : 'Edit'}
            </button>
            {isAdmin && (
              <button
                className="st-btn"
                onClick={bulkDelete}
                disabled={selected.size === 0}
                style={bulkBtnStyle('danger', selected.size === 0)}
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            )}
          </div>
        </div>
      )}

      <div className="st-list" style={{ flex: 1, overflowY: 'auto', paddingBottom: 90, marginTop: 2 }}>
        {(statusFilter === 'active' ? activeList.length === 0
          : statusFilter === 'dropped' ? droppedList.length === 0
          : filtered.length === 0) && <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: 30 }}>No students found.</div>}
        {statusFilter !== 'dropped' && activeList.map(s => (
          <div key={s.id} className={`card st-card${selected.has(s.id) ? ' is-sel' : ''}`} {...rowProps(s)}>
            <RollBadge rollNo={s.roll_no} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#182238', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
            </div>
            <RowTail selectMode={selectMode} on={selected.has(s.id)} />
          </div>
        ))}

        {statusFilter !== 'active' && droppedList.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 2px 8px', color: 'var(--gray)' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Dropout / Banned Students</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            {droppedList.map(s => (
              <div key={s.id} className={`card st-card is-drop${selected.has(s.id) ? ' is-sel' : ''}`} {...rowProps(s)}>
                <RollBadge rollNo={s.roll_no} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#182238', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {s.name}
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 6, background: 'rgba(220,38,38,.10)', color: '#DC2626' }}>Dropout</span>
                  </div>
                </div>
                <RowTail selectMode={selectMode} on={selected.has(s.id)} tone="red" />
              </div>
            ))}
          </>
        )}
      </div>

      {showDownload && (
        <FilterPopup title="Download as" onClose={() => setShowDownload(false)}>
          <button
            className="st-btn st-chip"
            onClick={() => { setShowDownload(false); exportStudentsPdf(stripContact(filtered)); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ display: 'flex', color: '#1A336A' }}><Icon name="fileText" size={20} /></span> PDF
          </button>
          <button
            className="st-btn st-chip"
            onClick={() => { setShowDownload(false); exportStudentsXlsx(stripContact(filtered)); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ display: 'flex', color: '#1A336A' }}><Icon name="sheet" size={20} /></span> Excel
          </button>
        </FilterPopup>
      )}

      {/* Floating add button — bottom right, hidden while selecting students */}
      {!selectMode && (
        <div style={{ position: 'relative', height: 0, flexShrink: 0, overflow: 'visible' }}>
        <LimitGatedButton
          resource="students"
          currentCount={students.length}
          onClick={() => setShowAdd(true)}
          className="btn btn-primary st-btn"
          aria-label="Add student"
          style={{
            position: 'absolute', right: 18, bottom: 16, zIndex: 40,
            width: 52, height: 52, borderRadius: '50%', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(26,51,106,.32)',
          }}
        >
          <Icon name="plus" size={24} stroke={2.2} />
        </LimitGatedButton>
        </div>
      )}

      {showAdd && (
        <AddStudentModal
          academyId={academyId}
          sports={visibleSports}
          batches={visibleBatches}
          existingStudents={visibleStudents}
          onClose={() => setShowAdd(false)}
          onSaved={() => setShowAdd(false)} /* single-row add/edit — AcademyDataContext's realtime subscription already merges it in, no full refetch needed */
        />
      )}

      {showRestoreConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', width: '100%', maxWidth: 420, borderRadius: 16, boxShadow: 'var(--shadow)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ display: 'flex', color: '#1A336A' }}><Icon name="restore" size={18} /></span>
              <span style={{ fontWeight: 800, fontSize: 15 }}>Restore {selected.size} student{selected.size === 1 ? '' : 's'}?</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 18 }}>
              {selected.size === 1 ? 'This student' : `These ${selected.size} students`} will be moved back to the Active list.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }} onClick={() => setShowRestoreConfirm(false)} disabled={restoring}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 1.4, justifyContent: 'center', padding: '10px 0' }} onClick={restoreSelected} disabled={restoring}>
                {restoring ? 'Restoring…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkEdit && (
        <BulkEditStudentsModal
          students={visibleStudents}
          selectedIds={selected}
          allStudents={visibleStudents}
          sports={visibleSports}
          batches={visibleBatches}
          academyId={academyId}
          mode={selectedGroup}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => { setShowBulkEdit(false); exitSelectMode(); refresh(); }}
        />
      )}

      {showImport && (
        <ImportStudentsModal
          academyId={academyId}
          sports={visibleSports}
          batches={visibleBatches}
          existingStudents={visibleStudents}
          totalStudents={students.length}
          onClose={() => setShowImport(false)}
          onImported={refresh}
        />
      )}

      {detailStudent && (
        <StudentDetailModal
          student={detailStudent}
          academyId={academyId}
          isAdmin={isAdmin}
          canViewContact={canViewContactStudents}
          canExport={canExportStudents}
          onClose={() => setDetailStudent(null)}
          onEdit={(s) => setEditStudent(s)}
          onChanged={refresh}
        />
      )}

      {editStudent && (
        <AddStudentModal
          academyId={academyId}
          sports={visibleSports}
          batches={visibleBatches}
          student={editStudent}
          existingStudents={visibleStudents}
          onClose={() => setEditStudent(null)}
          onSaved={() => setEditStudent(null)} /* single-row edit — realtime handles the merge */
        />
      )}
    </div>
  );
}
