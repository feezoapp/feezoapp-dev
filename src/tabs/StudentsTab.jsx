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

// Download / upload icons (arrow into/out of a tray) — stroke follows the button's text color.
function TrayIcon({ up, size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {up
        ? <><line x1="12" y1="15" x2="12" y2="3" /><polyline points="7 8 12 3 17 8" /></>
        : <><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 10 12 15 17 10" /></>}
      <path d="M4 17v3h16v-3" />
    </svg>
  );
}

const SORT_OPTIONS = [
  { v: 'roll_asc', l: 'Roll No ↑' },
  { v: 'roll_desc', l: 'Roll No ↓' },
  { v: 'name_az', l: 'Name A→Z' },
  { v: 'name_za', l: 'Name Z→A' },
];

function RollBadge({ rollNo }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 34, height: 24, padding: '0 8px', borderRadius: 8,
      background: 'var(--accent2)', color: '#fff', fontSize: 12, fontWeight: 800, flexShrink: 0,
    }}>
      {rollNo || '+Roll'}
    </span>
  );
}

// Same popup styling used by HomeTab's Month/Sport/Batch filters — a dark
// overlay + a centered white card of radio rows, closing itself on selection.
// Only the presentation changed here; every caller below still passes the
// same title/onClose/children and the same RadioRow name/checked/onChange/label.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 18, padding: '16px 12px 12px', width: '100%', maxWidth: 300,
          maxHeight: '72vh', overflowY: 'auto', boxShadow: '0 12px 34px rgba(10,18,35,.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 6, padding: '0 4px' }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1A336A', textAlign: 'center' }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute', right: 0, width: 26, height: 26, borderRadius: '50%',
              background: '#f1f3f8', border: 'none', color: '#6b7385', fontSize: 15,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            ×
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
        fontWeight: checked ? 700 : 500,
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

// Rounded pill for the Active/Dropped counters in the header — same toggle
// look as HomeTab's clickable summary chips (navy when active, quiet
// neutral/red when not). tone only changes the *unselected* colors.
function countPillStyle(active, tone) {
  if (tone === 'red') {
    return {
      fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 20, cursor: 'pointer', border: 'none',
      background: active ? '#ef4444' : 'rgba(220,38,38,.12)', color: active ? '#fff' : '#ef4444',
      whiteSpace: 'nowrap',
    };
  }
  return {
    fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 20, cursor: 'pointer', border: 'none',
    background: active ? '#1A336A' : 'var(--card2)', color: active ? '#fff' : 'var(--gray)',
    whiteSpace: 'nowrap',
  };
}

// Sport/Batch/Sort chip — same rounded, bordered "light" button used for
// HomeTab's Month/Sport/Batch selectors, with a dropdown caret added.
const filterChipStyle = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0,
  fontSize: 11, fontWeight: 700, padding: '8px 6px', borderRadius: 11,
  border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', cursor: 'pointer',
};

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
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
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

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header card — same white/bordered/shadowed container recipe as HomeTab's
          Trends panel (var(--card) + var(--border) + 16px radius + soft shadow),
          tightened to a compact two-row header per the latest spec. */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '10px 12px 9px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>👥</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#1A336A' }}>Students</span>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'nowrap' }}>
            {canExportStudents && <button className="btn btn-gold btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 8px', fontSize: 10.5, borderRadius: 8, fontWeight: 700 }} onClick={() => setShowDownload(true)}><TrayIcon /> Download</button>}
            {canImportStudents && <button className="btn btn-outline btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 8px', fontSize: 10.5, borderRadius: 8, fontWeight: 700, whiteSpace: 'nowrap' }} onClick={() => setShowImport(true)}><TrayIcon up /> Import</button>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button
              onClick={() => setStatusFilter(f => f === 'active' ? 'all' : 'active')}
              style={countPillStyle(statusFilter === 'active', 'blue')}
            >
              {(sportFilter || batchFilter || search)
                ? `${activeList.length} active of ${visibleStudents.filter(s => !s.banned).length}`
                : `${visibleStudents.filter(s => !s.banned).length} active`}
            </button>
            {visibleStudents.some(s => s.banned) && (
              <button
                onClick={() => setStatusFilter(f => f === 'dropped' ? 'all' : 'dropped')}
                style={countPillStyle(statusFilter === 'dropped', 'red')}
              >
                {(sportFilter || batchFilter || search)
                  ? `${droppedList.length} dropped of ${visibleStudents.filter(s => s.banned).length}`
                  : `${visibleStudents.filter(s => s.banned).length} dropped`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search + filters card — same container recipe as the header above, also tightened. */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '10px 10px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)',
        display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 13, display: 'flex', color: 'var(--gray)', pointerEvents: 'none' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={selectAllOnTap}
            onClick={selectAllOnTap}
            placeholder="Search by name or roll number…"
            style={{
              width: '100%', height: 40, padding: '0 38px 0 38px', boxSizing: 'border-box',
              borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)',
              fontSize: 13, color: '#182238', outline: 'none',
            }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
              style={{
                position: 'absolute', right: 9, width: 24, height: 24, borderRadius: '50%', border: 'none',
                background: 'var(--border)', color: 'var(--gray)', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11,
              }}>
              ✕
            </button>
          )}
        </div>

        {/* sport / batch / sort — same rounded chip style, opens the same popup as before */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={filterChipStyle} onClick={() => setPopup('sport')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sportFilter || 'All Sports'}</span>
            <span style={{ fontSize: 9, flexShrink: 0 }}>▾</span>
          </button>
          <button style={filterChipStyle} onClick={() => setPopup('batch')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBatchLabel || 'All Batches'}</span>
            <span style={{ fontSize: 9, flexShrink: 0 }}>▾</span>
          </button>
          <button style={filterChipStyle} onClick={() => setPopup('sort')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedSortLabel || 'Sort'}</span>
            <span style={{ fontSize: 9, flexShrink: 0 }}>▾</span>
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

      {selectMode && (
        <div style={{ background: 'var(--accent)', border: '1px solid var(--accent2)', borderRadius: 10, padding: '7px 8px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>{selected.size} selected</div>
            <button
              onClick={exitSelectMode}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', border: '1.5px solid #000', borderRadius: 6, background: '#fff', color: '#000', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 4 }}>
            <button
              onClick={selectAll}
              disabled={selected.size === (selectedGroup === 'dropped' ? droppedList.length : activeList.length)}
              style={{ minWidth: 0, fontSize: 10, fontWeight: 700, padding: '6px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: '1.5px solid #000', borderRadius: 6, background: '#fff', color: '#000', opacity: selected.size === (selectedGroup === 'dropped' ? droppedList.length : activeList.length) ? 0.5 : 1 }}
            >
              ☑ All
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              style={{ minWidth: 0, fontSize: 10, fontWeight: 700, padding: '6px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: '1.5px solid #000', borderRadius: 6, background: '#fff', color: '#000', opacity: selected.size === 0 ? 0.5 : 1 }}
            >
              ✕ None
            </button>
            <button
              onClick={() => selectedGroup === 'dropped' ? setShowRestoreConfirm(true) : setShowBulkEdit(true)}
              disabled={selected.size === 0}
              style={{ minWidth: 0, fontSize: 10, fontWeight: 700, padding: '6px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: '1.5px solid #000', borderRadius: 6, background: 'var(--primary, #4f6bed)', color: '#fff', opacity: selected.size === 0 ? 0.5 : 1 }}
            >
              {selectedGroup === 'dropped' ? '↩️ Restore' : '✏️ Edit'}
            </button>
            {isAdmin && (
              <button
                onClick={bulkDelete}
                disabled={selected.size === 0}
                style={{ minWidth: 0, fontSize: 10, fontWeight: 700, padding: '6px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: '1.5px solid #000', borderRadius: 6, background: 'var(--red)', color: '#fff', opacity: selected.size === 0 ? 0.5 : 1 }}
              >
                🗑️ Del
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 90, marginTop: 4 }}>
        {(statusFilter === 'active' ? activeList.length === 0
          : statusFilter === 'dropped' ? droppedList.length === 0
          : filtered.length === 0) && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30 }}>No students found.</div>}
        {statusFilter !== 'dropped' && activeList.map(s => (
          <div key={s.id} className="card" {...pressProps(s)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
            background: selected.has(s.id) ? 'rgba(91,124,196,.16)' : 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.04)',
            outline: selected.has(s.id) ? '2px solid #1A336A' : 'none', outlineOffset: -2,
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'pan-y',
          }}>
            <RollBadge rollNo={s.roll_no} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#182238', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
            </div>
            <span style={{ color: 'var(--gray)', fontSize: 16, flexShrink: 0 }}>›</span>
          </div>
        ))}

        {statusFilter !== 'active' && droppedList.length > 0 && (
          <>
            <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '18px 0 10px' }}>
              — Dropout / Banned Students —
            </div>
            {droppedList.map(s => (
              <div key={s.id} className="card" {...pressProps(s)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
                background: selected.has(s.id) ? 'rgba(220,38,38,.16)' : 'rgba(220,38,38,.05)',
                border: '1px solid rgba(220,38,38,.25)', borderRadius: 14,
                outline: selected.has(s.id) ? '2px solid #ef4444' : 'none', outlineOffset: -2,
                userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'pan-y',
              }}>
                <RollBadge rollNo={s.roll_no} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#182238', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {s.name}
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(220,38,38,.12)', color: '#ef4444' }}>Dropout</span>
                  </div>
                </div>
                <span style={{ color: 'var(--gray)', fontSize: 16, flexShrink: 0 }}>›</span>
              </div>
            ))}
          </>
        )}
      </div>

      {showDownload && (
        <FilterPopup title="Download as" onClose={() => setShowDownload(false)}>
          <button
            onClick={() => { setShowDownload(false); exportStudentsPdf(stripContact(filtered)); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 20 }}>📄</span> PDF
          </button>
          <button
            onClick={() => { setShowDownload(false); exportStudentsXlsx(stripContact(filtered)); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 20 }}>📊</span> Excel
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
          className="btn btn-primary"
          aria-label="Add student"
          style={{
            position: 'absolute', right: 18, bottom: 16, zIndex: 40,
            width: 54, height: 54, borderRadius: '50%', padding: 0, fontSize: 28, fontWeight: 400, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(26,51,106,.35)',
          }}
        >
          +
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
              <span style={{ fontSize: 18 }}>↩️</span>
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
                {restoring ? 'Restoring…' : `↩️ Continue`}
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
