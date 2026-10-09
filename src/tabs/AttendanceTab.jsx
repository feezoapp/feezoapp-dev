import { useEffect, useMemo, useRef, useState } from 'react';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import { supabase } from '../lib/supabaseClient';
import { exportGenericPdf, exportGenericXlsx } from '../lib/exporters';
import ImportAttendanceModal from '../components/ImportAttendanceModal';

// ---------------------------------------------------------------------------
// Presentation-only helpers (icons, styles). No data or attendance logic here.
// ---------------------------------------------------------------------------

// Outline icons (Lucide-style, 24px grid, round caps/joins, one stroke weight).
const ICONS = {
  calendarCheck: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  fileText: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  sheet: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M8 13h2" /><path d="M14 13h2" /><path d="M8 17h2" /><path d="M14 17h2" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  upload: <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 17v3h16v-3" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  arrowUp: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  search: <><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  checkCircle: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></>,
  xCircle: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  unlock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  umbrella: <><path d="M22 12a10.06 10.06 1 0 0-20 0Z" /><path d="M12 12v8a2 2 0 0 0 4 0" /><path d="M12 2v1" /></>,
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54Z" />,
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

// Scoped hover / press / focus styles and small transitions. Prefixed `at-`.
const ATTENDANCE_CSS = `
.at-btn{transition:transform .12s ease,background-color .15s ease,border-color .15s ease,box-shadow .15s ease,opacity .15s ease,color .15s ease}
.at-btn:active:not(:disabled){transform:scale(.96)}
.at-btn:focus-visible,.at-card:focus-visible,.at-check:focus-within{outline:2px solid #5B7CC4;outline-offset:2px}
.at-chip:hover{border-color:#9DB2DD}
.at-round:hover:not(:disabled){background:#EEF2FA}
.at-search{transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.at-search:focus{border-color:#5B7CC4 !important;box-shadow:0 0 0 3px rgba(91,124,196,.18);background:#fff !important}
.at-panel{animation:at-pop .16s ease}
.at-overlay{animation:at-fade .15s ease}
.at-sheet{animation:at-pop .16s ease}
@keyframes at-fade{from{opacity:0}to{opacity:1}}
@keyframes at-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.at-list .at-card{background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(16,32,64,.04);transition:border-color .15s ease,box-shadow .15s ease}
@media (hover:hover){.at-list .at-card:hover{border-color:#B9C7E6;box-shadow:0 2px 8px rgba(16,32,64,.07)}}
.at-pa{width:38px;height:34px;border-radius:9px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid #C5D0EA;background:#fff;color:#5B6785;display:flex;align-items:center;justify-content:center;padding:0;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .12s ease}
.at-pa:active{transform:scale(.94)}
.at-pa:hover{border-color:#5B7CC4}
.at-pa:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.at-pa.on-p{background:#1A336A;border-color:#1A336A;color:#fff}
.at-pa.on-late{background:#EA8A1A;border-color:#EA8A1A;color:#fff}
.at-pa.on-a{background:#DC2626;border-color:#DC2626;color:#fff}
@media (prefers-reduced-motion:reduce){.at-btn,.at-search,.at-panel,.at-overlay,.at-sheet,.at-card,.at-pa{animation:none !important;transition:none !important}}
`;

// Equal-size filter chip; highlighted light blue when a filter is applied.
function chipStyle(on) {
  return {
    flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0,
    height: 36, fontSize: 12, fontWeight: 600, padding: '0 8px', borderRadius: 10, fontFamily: 'inherit',
    border: `1px solid ${on ? '#5B7CC4' : 'var(--border)'}`,
    background: on ? 'rgba(91,124,196,.10)' : 'var(--card2)', color: '#1A336A', cursor: 'pointer',
  };
}

// Header action buttons (Download / Import) — outlined style: white circle,
// navy ring, navy arrow (the top row of the reference icons).
function actionBtnStyle(disabled) {
  return {
    width: 36, height: 36, borderRadius: '50%', border: '2px solid #04213A', padding: 0, flexShrink: 0,
    background: '#fff', color: '#04213A', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(4,33,58,.2)', opacity: disabled ? 0.5 : 1,
  };
}

// Small square prev/next arrows beside the Day / Month / Year buttons.
const arrowBtnStyle = {
  width: 28, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: '#1A336A',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SORT_OPTIONS = [
  { v: 'roll_asc', l: 'Roll No · Ascending', short: 'Roll No', dir: 'arrowUp' },
  { v: 'roll_desc', l: 'Roll No · Descending', short: 'Roll No', dir: 'arrowDown' },
  { v: 'name_az', l: 'Name A–Z', short: 'Name', dir: 'arrowUp' },
  { v: 'name_za', l: 'Name Z–A', short: 'Name', dir: 'arrowDown' },
  { v: 'present_first', l: 'Present first', short: 'Present first' },
  { v: 'absent_first', l: 'Absent first', short: 'Absent first' },
  { v: 'unmarked_first', l: 'Unmarked first', short: 'Unmarked first' },
];

const STATUS_OPTIONS = [
  { v: 'all', l: 'All' },
  { v: 'present', l: 'Present' },
  { v: 'absent', l: 'Absent' },
];

// IMPORTANT: build the YYYY-MM-DD string from local date parts, never via
// toISOString() — that converts to UTC first, which silently shifts the
// date by a day for any timezone ahead of UTC (e.g. IST) and is what made
// the ‹ › navigation arrows appear broken.
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => toIso(new Date());
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// Supabase/PostgREST caps any single .select() at 1000 rows by default.
// Year (and, for a busy academy, even Month) view can easily have more
// attendance rows than that in range, so a plain query silently truncates —
// this was confirmed to undercount real months' P/A totals. Page through
// in 1000-row chunks instead of trusting one request to return everything.
const PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// A student can now hold multiple enrollments (same or different sports) —
// attendance is tracked per enrollment, not per student, so every state map
// below is keyed by this composite key rather than bare student_id.
// Trimmed + lowercased so a stray space or casing drift between what's
// stored on an old attendance row and the student's *current* enrollment
// text (e.g. a renamed batch) doesn't silently break the lookup — this was
// causing month view (which matches per sport+batch) to show 0P/0A while
// year view (which only matches by student_id) still showed real totals.
const norm = (v) => (v || '').toString().trim().toLowerCase();
const keyFor = (studentId, sport, batchLabel) => `${studentId}::${norm(sport)}::${norm(batchLabel)}`;

// Key for dayStatusMap (register-closed lookups), independent of student.
// '*' is the batch value used for rows written before attendance_day_status
// had a `batch` column — those closes covered every batch of that sport, so
// they're checked as a fallback anywhere a specific batch key is missed.
const dsKey = (sport, batch) => `${norm(sport)}::${norm(batch)}`;

// A student shouldn't appear (or be markable/bulk-markable) for any date
// before they actually joined — matches the enrolledBy check FeesTab uses,
// so a student excluded from a month's fee list because of their join_date
// is excluded from that same period here too, instead of showing up in
// Attendance but silently vanishing from Fees.
const isEnrolledByRef = (joinDate, refDateIso) => !joinDate || joinDate <= refDateIso;

// A banned student still keeps their attendance history for periods before
// they were banned — same principle as an ended enrollment still showing its
// old sport/batch for the days it was active (enrollmentOverlapsPeriod
// below). This only tells you whether a REFERENCE date/period-start falls
// on or after the ban, not whether every day in a range is post-ban — so a
// period straddling the ban date still surfaces the pre-ban days.
const bannedByRef = (s, refDateIso) => !!s.banned && (!s.banned_on || s.banned_on <= refDateIso);

// An enrollment counts for a single date if it had started by then and,
// if it's since ended, hadn't ended yet.
const enrollmentActiveOn = (en, dateIso) =>
  (!en.join_date || en.join_date <= dateIso) && (!en.left_date || en.left_date >= dateIso);

// An enrollment counts for a period [from, to] if it was active for any
// part of it — so an already-ended enrollment still surfaces its old
// sport/batch (and the attendance recorded against it) in Month/Year
// views covering when it was actually active, instead of disappearing
// the moment it's superseded by a newer enrollment.
const enrollmentOverlapsPeriod = (en, fromIso, toIso) =>
  (!en.join_date || en.join_date <= toIso) && (!en.left_date || en.left_date >= fromIso);

function RollBadge({ rollNo }) {
  return (
    <div style={{
      minWidth: 30, height: 30, padding: '0 4px', borderRadius: '50%',
      background: 'var(--accent2, #4a6cf7)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: rollNo && String(rollNo).length > 2 ? 10 : 12, fontWeight: 700, flexShrink: 0,
    }}>
      {rollNo || '—'}
    </div>
  );
}

// Popup shell shared by the Sport / Batch / Status / Sort / Day / Month / Year
// pickers — same look as the Students screen. Props are unchanged.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      className="at-overlay"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="at-sheet" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '14px 12px 10px', width: '100%', maxWidth: 320, maxHeight: 'min(68vh, 480px)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(10,18,35,.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: 6, padding: '0 4px', flexShrink: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A336A', textAlign: 'center' }}>{title}</div>
          <button className="at-btn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 0, width: 28, height: 28, borderRadius: '50%', background: '#F1F3F8', border: 'none', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
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

export default function AttendanceTab() {
  const { visibleStudents, visibleStudentsForHistory, visibleSports, visibleBatches, refresh } = useAcademyData();
  const { isAdmin, academyId, user, appUser, canExportAttendance, canImportAttendance, canViewAttendance } = useAuth();
  const { hasFeature, cheapestPlanWithFeature } = usePlan();
  // Matches the `marked_by` text column in Supabase — real name lives on
  // appUser (the app_users row), not the raw Supabase auth `user`.
  const markedBy = appUser?.name || user?.email || (isAdmin ? 'Admin' : 'Staff');

  const [date, setDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState('day'); // 'day' | 'month' | 'year'
  const [panelOpen, setPanelOpen] = useState(false); // date picker sub-panel: collapsed by default
  const [search, setSearch] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'present' | 'absent' — day view only
  const [sortBy, setSortBy] = useState('roll_asc');
  const [popup, setPopup] = useState(null); // 'sport' | 'batch' | 'status' | 'sort' | 'day' | 'month' | 'year' | null
  const [records, setRecords] = useState({}); // student_id -> 'P' | 'A'  (day mode only, matches db status codes)
  const [lateMap, setLateMap] = useState({}); // student_id -> bool, marked Present after that sport's register closed
  const [periodRows, setPeriodRows] = useState({}); // student_id -> { present, absent }  (month mode)
  const [classDaysByKey, setClassDaysByKey] = useState({}); // dsKey(sport,batch) -> count of days with ≥1 Present this month
  const [monthClassDays, setMonthClassDays] = useState(0); // union of all present-days this month, across whatever's in view
  const [yearSummary, setYearSummary] = useState({}); // monthIndex(0-11) -> { days:Set<string>, p, a, byDate: {iso -> {p,a}} }  (year mode)
  const [expandedMonth, setExpandedMonth] = useState(null); // monthIndex currently expanded in year view, or null
  const [dayStatusMap, setDayStatusMap] = useState({}); // sport -> completed bool, for the selected date
  const [completing, setCompleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDownload, setShowDownload] = useState(false); // PDF / Excel chooser
  const [reloadKey, setReloadKey] = useState(0);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const listScrollRef = useRef(null);
  // Tracks which date `dayStatusMap` was last built for, so a same-date
  // refetch can only ever ADD a confirmed-closed sport, never remove one —
  // closing a register is one-way, so a flaky read should never silently
  // reopen it. Switching to a different date still resets it properly.
  const dayStatusDateRef = useRef(date);

  const dateObj = new Date(date + 'T00:00:00');
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  const isFutureDate = date > todayStr();

  const setDay = (d) => setDate(toIso(new Date(year, month, d)));
  const setMonth = (m) => setDate(toIso(new Date(year, m, Math.min(day, daysInMonth(year, m)))));
  const setYear = (y) => setDate(toIso(new Date(y, month, Math.min(day, daysInMonth(y, month)))));
  const shiftDay = (delta) => setDate(toIso(new Date(year, month, day + delta)));
  const shiftMonth = (delta) => setDate(toIso(new Date(year, month + delta, Math.min(day, daysInMonth(year, month + delta)))));
  const shiftYear = (delta) => setYear(year + delta);

  // The reference date range a student's enrollment history is checked
  // against — the period currently being viewed. Day view uses a single
  // date; Month/Year view use the full [start, end] range, so an
  // enrollment that was active for only PART of the period (e.g. a student
  // switched sport/batch mid-month) still surfaces its old sport/batch —
  // and the attendance recorded against it — for that period, instead of
  // disappearing the moment it's superseded by a newer enrollment.
  const periodStart = useMemo(() => {
    if (viewMode === 'day') return date;
    if (viewMode === 'month') return toIso(new Date(year, month, 1));
    return toIso(new Date(year, 0, 1));
  }, [viewMode, date, year, month]);

  const periodEnd = useMemo(() => {
    if (viewMode === 'day') return date;
    if (viewMode === 'month') return toIso(new Date(year, month + 1, 0));
    return toIso(new Date(year, 11, 31));
  }, [viewMode, date, year, month]);

  useEffect(() => { setExpandedMonth(null); }, [year, viewMode, sportFilter, batchFilter]);

  // Tapping the search field while it already has text selects it all,
  // so typing immediately replaces the previous query. No-op on an empty field.
  const selectAllOnTap = (e) => {
    if (e.target.value) e.target.select();
  };

  const students = useMemo(() => {
    // Built from each student's full enrollment HISTORY (not just the
    // currently-active enrollment), keeping any enrollment that overlapped
    // the period being viewed. This is what makes Month/Year view still
    // show a student's old sport/batch (and its attendance) for the
    // period they were actually in it, even after they've since switched
    // to a different sport/batch.
    const rows = [];
    visibleStudentsForHistory.forEach(s => {
      if (!isEnrolledByRef(s.join_date, periodEnd)) return;
      if (bannedByRef(s, periodStart)) return;
      const history = (s.enrollmentHistory && s.enrollmentHistory.length > 0)
        ? s.enrollmentHistory
        : [{ sport: s.sport, batchLabel: s.batchLabel, join_date: s.join_date, left_date: null }];
      const seen = new Set();
      history.forEach(en => {
        if (!en.sport) return;
        if (!enrollmentOverlapsPeriod(en, periodStart, periodEnd)) return;
        const key = keyFor(s.id, en.sport, en.batchLabel);
        if (seen.has(key)) return; // rejoined the same sport/batch twice — one row is enough
        seen.add(key);
        rows.push({ student: s, sport: en.sport, batchLabel: en.batchLabel, key });
      });
    });
    let list = rows.filter(r => {
      if (sportFilter && r.sport !== sportFilter) return false;
      if (batchFilter && r.batchLabel !== batchFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.student.name?.toLowerCase().includes(q) || r.student.roll_no?.toLowerCase?.().includes(q))) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'roll_desc': return (b.student.roll_no || '').localeCompare(a.student.roll_no || '');
        case 'name_az': return (a.student.name || '').localeCompare(b.student.name || '');
        case 'name_za': return (b.student.name || '').localeCompare(a.student.name || '');
        default: return (a.student.roll_no || '').localeCompare(b.student.roll_no || '');
      }
    });
    return list;
  }, [visibleStudentsForHistory, sportFilter, batchFilter, search, sortBy, periodStart, periodEnd]);

  // "Mark All" and the P/A summary counts intentionally ignore the search box —
  // they operate on the full sport+batch scoped roster, matching the HTML app.
  const bulkTargets = useMemo(() => {
    const rows = [];
    visibleStudentsForHistory.forEach(s => {
      if (!isEnrolledByRef(s.join_date, date)) return;
      if (bannedByRef(s, date)) return;
      const history = (s.enrollmentHistory && s.enrollmentHistory.length > 0)
        ? s.enrollmentHistory
        : [{ sport: s.sport, batchLabel: s.batchLabel, join_date: s.join_date, left_date: null }];
      const seen = new Set();
      history.forEach(en => {
        if (!en.sport) return;
        if (!enrollmentActiveOn(en, date)) return;
        if (sportFilter && en.sport !== sportFilter) return;
        if (batchFilter && en.batchLabel !== batchFilter) return;
        const key = keyFor(s.id, en.sport, en.batchLabel);
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ student: s, sport: en.sport, batchLabel: en.batchLabel, key });
      });
    });
    return rows;
  }, [visibleStudentsForHistory, sportFilter, batchFilter, date]);

  // Day-view-only re-sort (present/absent first) and status filter — applied on
  // top of `students` since both depend on the fetched records for the date.
  const dayStudents = useMemo(() => {
    if (viewMode !== 'day') return students;
    let list = students;
    if (sortBy === 'present_first' || sortBy === 'absent_first' || sortBy === 'unmarked_first') {
      const rank = (r) => {
        const v = records[r.key];
        if (sortBy === 'present_first') return v === 'P' ? 0 : v === 'A' ? 2 : 1;
        if (sortBy === 'absent_first') return v === 'A' ? 0 : v === 'P' ? 2 : 1;
        return v ? 1 : 0; // unmarked_first: unmarked → marked
      };
      list = [...list].sort((a, b) => rank(a) - rank(b) || (a.student.roll_no || '').localeCompare(b.student.roll_no || ''));
    }
    if (statusFilter !== 'all') {
      list = list.filter(r => (statusFilter === 'present' ? records[r.key] === 'P' : records[r.key] === 'A'));
    }
    return list;
  }, [viewMode, students, sortBy, statusFilter, records]);

  const batchesForSport = visibleBatches.filter(b => !sportFilter || b.sport === sportFilter);

  // A day only counts as a "class day" if someone was actually marked. Shown as
  // a 🏖️ holiday badge otherwise. Scoped by sportFilter only (not batch/search),
  // matching the HTML app's isClassDay check.
  const classDayRows = useMemo(() => {
    return sportFilter ? bulkTargets.filter(r => r.sport === sportFilter) : bulkTargets;
  }, [bulkTargets, sportFilter]);
  const classDay = useMemo(() => {
    const keys = new Set(classDayRows.map(r => r.key));
    return Object.keys(records).some(k => keys.has(k) && (records[k] === 'P' || records[k] === 'A'));
  }, [records, classDayRows]);

  // Best-effort activity log, matching the columns admin/ActivityPage.jsx
  // actually reads (actor_name, then action || description). Written to both
  // action and description so it shows up regardless of which one it prefers.
  // Never blocks the UI if the insert fails.
  // Best-effort activity log. `audit_log` only has the legacy columns —
  // user_id, role, action, detail — no actor_id/actor_name/description.
  const logAttendance = async (message) => {
    try {
      const { error } = await supabase.from('audit_log').insert({
        academy_id: academyId,
        user_id: markedBy,
        role: isAdmin ? 'admin' : 'staff',
        action: message,
        detail: message,
      });
      if (error) console.error('audit_log insert failed (attendance):', error);
    } catch (e) { console.error('audit_log insert threw (attendance):', e); }
  };

  // ---- Fetch attendance for the current view ----
  useEffect(() => {
    (async () => {
      if (!academyId) return;
      setLoading(true);
      try {
      if (viewMode === 'day') {
        const { data } = await supabase.from('attendance').select('*')
          .eq('academy_id', academyId).eq('date', date);
        const map = {};
        const late = {};
        (data || []).forEach(r => {
          const k = keyFor(r.student_id, r.sport, r.batch);
          map[k] = r.status; late[k] = !!r.is_latecomer;
        });
        setRecords(map);
        setLateMap(late);

        // Optional table, scoped per (academy, date, sport) — requires a `sport`
        // text column and a unique constraint on (academy_id, date, sport).
        // Falls back to a single whole-day flag (applies to every sport) if
        // that column hasn't been migrated in yet — matches the write-side
        // fallback in markAllDone, so close-state stays consistent either way.
        // Merged (never downgraded) against the previous same-date state —
        // closing a register is one-way, so a flaky read must never silently
        // reopen one we already confirmed closed locally.
        const applyDayStatus = (dmap) => {
          const isNewDate = dayStatusDateRef.current !== date;
          dayStatusDateRef.current = date;
          setDayStatusMap(prev => {
            const base = isNewDate ? {} : prev;
            const merged = { ...base };
            Object.keys(dmap).forEach(k => { merged[k] = merged[k] || dmap[k]; });
            return merged;
          });
        };
        try {
          const { data: statusRows, error: statusErr } = await supabase.from('attendance_day_status')
            .select('sport,batch,completed').eq('academy_id', academyId).eq('date', date);
          if (statusErr) throw statusErr;
          const dmap = {};
          (statusRows || []).forEach(r => { dmap[dsKey(r.sport, r.batch || '*')] = !!r.completed; });
          applyDayStatus(dmap);
        } catch {
          try {
            // `batch` column not migrated in yet — fall back to sport-only
            // granularity (pre-batch-lock behavior) via the '*' sentinel.
            const { data: sportRows, error: sportErr } = await supabase.from('attendance_day_status')
              .select('sport,completed').eq('academy_id', academyId).eq('date', date);
            if (sportErr) throw sportErr;
            const dmap = {};
            (sportRows || []).forEach(r => { dmap[dsKey(r.sport, '*')] = !!r.completed; });
            applyDayStatus(dmap);
          } catch {
            try {
              const { data: legacyRows } = await supabase.from('attendance_day_status')
                .select('completed').eq('academy_id', academyId).eq('date', date);
              const wholeDayDone = (legacyRows || []).some(r => r.completed);
              const dmap = {};
              if (wholeDayDone) visibleSports.forEach(sp => { dmap[dsKey(sp.name, '*')] = true; });
              applyDayStatus(dmap);
            } catch {
              applyDayStatus({});
            }
          }
        }
      } else if (viewMode === 'month') {
        const from = toIso(new Date(year, month, 1));
        const to = toIso(new Date(year, month + 1, 0));
        const buildMonthQuery = () => {
          let q = supabase.from('attendance').select('student_id,sport,batch,status,date')
            .eq('academy_id', academyId).gte('date', from).lte('date', to);
          if (sportFilter) q = q.eq('sport', sportFilter);
          if (sportFilter && batchFilter) q = q.eq('batch', batchFilter);
          return q;
        };
        const data = await fetchAllRows(buildMonthQuery);
        const agg = {};
        // A day counts as a class day for a given sport+batch if ANYONE in it
        // was marked Present that day — Absent-only days don't count (e.g. a
        // holiday nobody attended shouldn't inflate the denominator). Tracked
        // per sport+batch (different batches meet on different days) and also
        // as a global union across whatever's in view, for the header count.
        const classDaySets = {}; // dsKey(sport,batch) -> Set<iso date>
        const globalClassDays = new Set();
        (data || []).forEach(r => {
          const k = keyFor(r.student_id, r.sport, r.batch);
          if (!agg[k]) agg[k] = { present: 0, absent: 0 };
          if (r.status === 'P') {
            agg[k].present++;
            const dk = dsKey(r.sport, r.batch);
            if (!classDaySets[dk]) classDaySets[dk] = new Set();
            classDaySets[dk].add(r.date);
            globalClassDays.add(r.date);
          }
          else if (r.status === 'A') agg[k].absent++;
        });
        setPeriodRows(agg);
        setClassDaysByKey(Object.fromEntries(Object.entries(classDaySets).map(([k, v]) => [k, v.size])));
        setMonthClassDays(globalClassDays.size);
      } else {
        // Year view — monthly breakdown (class days + P/A totals), scoped to the
        // currently filtered roster, matching the HTML app's year view. When no
        // sport/batch filter is set this totals across ALL of a student's
        // enrollments (not split per-enrollment) — the year view only ever
        // showed monthly totals, not a per-enrollment breakdown.
        const from = toIso(new Date(year, 0, 1));
        const to = toIso(new Date(year, 11, 31));
        const buildYearQuery = () => {
          let q = supabase.from('attendance').select('date,student_id,status')
            .eq('academy_id', academyId).gte('date', from).lte('date', to);
          if (sportFilter) q = q.eq('sport', sportFilter);
          if (sportFilter && batchFilter) q = q.eq('batch', batchFilter);
          return q;
        };
        const data = await fetchAllRows(buildYearQuery);
        const idSet = new Set(students.map(r => r.student.id));
        const byMonth = {};
        for (let i = 0; i < 12; i++) byMonth[i] = { days: new Set(), p: 0, a: 0, byDate: {} };
        (data || []).forEach(r => {
          if (!idSet.has(r.student_id)) return;
          const mo = parseInt(r.date.slice(5, 7), 10) - 1;
          if (!byMonth[mo]) return;
          if (!byMonth[mo].byDate[r.date]) byMonth[mo].byDate[r.date] = { p: 0, a: 0 };
          if (r.status === 'P') { byMonth[mo].days.add(r.date); byMonth[mo].p++; byMonth[mo].byDate[r.date].p++; }
          else if (r.status === 'A') { byMonth[mo].a++; byMonth[mo].byDate[r.date].a++; }
        });
        setYearSummary(byMonth);
      }
      } catch (err) {
        console.error('Attendance fetch failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [academyId, date, viewMode, year, month, reloadKey, students, visibleSports, sportFilter, batchFilter]);

  // ---- Realtime sync ----
  // AcademyDataContext already keeps sports/batches/students/enrollments live;
  // `attendance` and `attendance_day_status` aren't loaded there (they're
  // view-scoped — day/month/year — so a bare upsert-into-context wouldn't
  // know which aggregate to update). Instead: for the day view, merge each
  // changed attendance row directly into `records`/`lateMap` (cheap, matches
  // what's already on screen). For month/year, a single row only ever moves
  // one cell of a pre-computed aggregate, so it's simpler and still cheap to
  // debounce a re-fetch via the existing effect above (bumping `reloadKey`)
  // rather than duplicate its aggregation logic here.
  const reloadDebounceRef = useRef(null);
  const scheduleReload = () => {
    clearTimeout(reloadDebounceRef.current);
    reloadDebounceRef.current = setTimeout(() => setReloadKey(k => k + 1), 400);
  };

  // `visibleSports` is a derived array from AcademyDataContext and gets a new
  // reference on renders even when its contents haven't changed. It used to
  // sit in the channel effect's dependency array below, which meant this
  // effect — and the channel it opens — was tearing down and rebuilding on
  // nearly every render, never giving the subscription a stable window to
  // actually receive events. Read the latest value through a ref instead so
  // the closure inside the handler stays fresh without forcing a resubscribe.
  const visibleSportsRef = useRef(visibleSports);
  useEffect(() => { visibleSportsRef.current = visibleSports; }, [visibleSports]);

  useEffect(() => {
    if (!academyId) return;

    const channel = supabase
      .channel(`attendance-${academyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `academy_id=eq.${academyId}` },
        (payload) => {
          const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
          if (!row) return;
          if (viewMode !== 'day') { scheduleReload(); return; }
          if (row.date !== date) return; // different day being viewed — nothing on screen changes
          const k = keyFor(row.student_id, row.sport, row.batch);
          if (payload.eventType === 'DELETE') {
            setRecords(prev => { const next = { ...prev }; delete next[k]; return next; });
            setLateMap(prev => { const next = { ...prev }; delete next[k]; return next; });
          } else {
            setRecords(prev => ({ ...prev, [k]: row.status }));
            setLateMap(prev => ({ ...prev, [k]: !!row.is_latecomer }));
          }
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_day_status', filter: `academy_id=eq.${academyId}` },
        (payload) => {
          if (viewMode !== 'day') return;
          // DELETE = an admin unlock (see unlockRegister). This is the one
          // case allowed to remove a lock rather than only ever adding one.
          if (payload.eventType === 'DELETE') {
            const row = payload.old;
            if (!row || row.date !== date || !row.sport) return;
            setDayStatusMap(m => {
              const next = { ...m };
              delete next[dsKey(row.sport, row.batch || '*')];
              return next;
            });
            return;
          }
          const row = payload.new;
          if (!row || row.date !== date) return;
          // Closing is otherwise one-way, so it's safe to only ever flip
          // these true — matches the merge-never-downgrades rule used for
          // the initial fetch above.
          if (row.sport && row.batch) {
            setDayStatusMap(m => (m[dsKey(row.sport, row.batch)] ? m : { ...m, [dsKey(row.sport, row.batch)]: !!row.completed }));
          } else if (row.sport) {
            setDayStatusMap(m => (m[dsKey(row.sport, '*')] ? m : { ...m, [dsKey(row.sport, '*')]: !!row.completed }));
          } else if (row.completed) {
            setDayStatusMap(m => {
              const merged = { ...m };
              visibleSportsRef.current.forEach(sp => { merged[dsKey(sp.name, '*')] = true; });
              return merged;
            });
          }
        })
      .subscribe();

    return () => { clearTimeout(reloadDebounceRef.current); supabase.removeChannel(channel); };
  }, [academyId, date, viewMode]);

  // Tapping P/A. Behavior depends on whether that student's sport register is
  // closed for the day (dayStatusMap[sport]):
  //  - Open register: normal mark / change (with confirm) / clear (tap again).
  //  - Closed register: existing marks are locked, EXCEPT a latecomer Present
  //    mark can still be flipped to Absent. Unmarked students can still be
  //    marked — Absent normally, or Present as a flagged "latecomer".
  // Closed if this exact sport+batch was closed, OR if a legacy (pre-batch)
  // whole-sport close covers it via the '*' sentinel.
  const isRegisterClosed = (sport, batch) => !!dayStatusMap[dsKey(sport, batch)] || !!dayStatusMap[dsKey(sport, '*')];

  const setStatus = (row, status) => {
    if (isFutureDate) { window.alert('Cannot mark attendance for future dates.'); return; }
    const sp = row.sport;
    const done = isRegisterClosed(sp, row.batchLabel);
    const existing = records[row.key];
    const isLate = !!lateMap[row.key];
    const student = row.student;

    if (done) {
      if (existing === 'A') {
        if (status === 'A') return; // already absent, no-op
        const ok = window.confirm(`Register is closed. Change ${student.name} from Absent → latecomer Present?`);
        if (!ok) return;
        applyStatus(row, 'P', true);
        logAttendance(`${student.name} → latecomer Present from Absent (${sp}) on ${date}`);
        return;
      }
      if (existing === 'P' && !isLate) { window.alert('Register is closed for this day — already marked, cannot change.'); return; }
      if (existing === 'P' && isLate && status === 'A') {
        const ok = window.confirm(`Change ${student.name} from Latecomer → Absent (${sp}) on ${date}?`);
        if (!ok) return;
        applyStatus(row, 'A', false);
        logAttendance(`${student.name} → Absent from latecomer (${sp}) on ${date}`);
        return;
      }
      if (existing === 'P' && isLate && status === 'P') return; // already marked, no-op
      // unmarked student, register closed
      if (status === 'A') {
        const ok = window.confirm(`Mark ${student.name} as Absent (${sp}) on ${date}?`);
        if (!ok) return;
        applyStatus(row, 'A', false);
        logAttendance(`${student.name} → Absent (${sp}) on ${date} [register closed]`);
        return;
      }
      const ok = window.confirm(`Register is closed. Mark ${student.name} as a latecomer (Present)?`);
      if (!ok) return;
      applyStatus(row, 'P', true);
      logAttendance(`${student.name} → latecomer Present (${sp}) on ${date}`);
      return;
    }

    // Register still open — normal flow
    if (existing === status) {
      // Admins only: tapping the already-selected mark clears it back to "not
      // marked". Staff tapping it again does nothing, and closed registers
      // never reach this point (they return above).
      if (!isAdmin) return;
      const ok = window.confirm(`Clear ${status === 'P' ? 'Present' : 'Absent'} mark for ${student.name}?`);
      if (!ok) return;
      clearStatus(row);
      logAttendance(`${student.name} → cleared (${sp}) on ${date}`);
      return;
    }
    if (existing) {
      const label = (v) => (v === 'P' ? 'Present' : 'Absent');
      const ok = window.confirm(`Change ${student.name}'s attendance from ${label(existing)} to ${label(status)}?`);
      if (!ok) return;
    }
    applyStatus(row, status, false);
    logAttendance(`${student.name} → ${status === 'P' ? 'Present' : 'Absent'} (${sp}) on ${date}`);
  };

  // Removes a single enrollment's mark for the selected date (same delete
  // filter markAll uses when it clears a whole batch). Restores the on-screen
  // mark if the delete fails so the UI never shows something the DB lacks.
  const clearStatus = async (row) => {
    if (!isAdmin || isRegisterClosed(row.sport, row.batchLabel)) return; // admin-only, never on a closed register
    const prevStatus = records[row.key];
    const prevLate = !!lateMap[row.key];
    setRecords(p => { const n = { ...p }; delete n[row.key]; return n; });
    setLateMap(p => { const n = { ...p }; delete n[row.key]; return n; });
    const { error } = await supabase.from('attendance').delete()
      .eq('academy_id', academyId).eq('date', date).eq('student_id', row.student.id).eq('sport', row.sport).eq('batch', row.batchLabel);
    if (error) {
      setRecords(p => ({ ...p, [row.key]: prevStatus }));
      setLateMap(p => ({ ...p, [row.key]: prevLate }));
      window.alert(`Couldn't clear ${row.student.name}'s attendance: ${error.message}`);
    }
  };

  const applyStatus = (row, status, isLate) => {
    setRecords(p => ({ ...p, [row.key]: status }));
    setLateMap(p => ({ ...p, [row.key]: !!isLate }));
    persistStatus(row, status, isLate);
  };

  // True once we learn (from a failed request) that `is_latecomer` doesn't
  // exist yet in Supabase — avoids retrying every single call for nothing.
  const missingLatecomerCol = useRef(false);

  // Writes a single enrollment's mark straight to Supabase so nothing depends
  // on a separate "Save" step. Uses the `is_latecomer` boolean column on
  // `attendance` when available, and transparently falls back to writing
  // without it if that column hasn't been migrated in yet — so marking never
  // breaks, it just can't flag latecomers until the column exists.
  const persistStatus = async (row, status, isLate) => {
    const dbRow = { academy_id: academyId, student_id: row.student.id, date, status, sport: row.sport, batch: row.batchLabel, marked_by: markedBy };
    if (!missingLatecomerCol.current) dbRow.is_latecomer = !!isLate;
    try {
      const { error } = await supabase.from('attendance').upsert(dbRow, { onConflict: 'academy_id,student_id,date,sport,batch' });
      if (error) throw error;
    } catch (err) {
      if (!missingLatecomerCol.current && /is_latecomer/i.test(err.message || '')) {
        missingLatecomerCol.current = true;
        return persistStatus(row, status, isLate); // retry once, without the column
      }
      window.alert(`Couldn't save ${row.student.name}'s attendance: ${err.message}`);
    }
  };

  const allPChecked = bulkTargets.length > 0 && bulkTargets.every(r => records[r.key] === 'P');
  const allAChecked = bulkTargets.length > 0 && bulkTargets.every(r => records[r.key] === 'A');

  const markAll = async (status) => {
    if (isFutureDate) { window.alert('Cannot mark attendance for future dates.'); return; }
    if (!sportFilter || !batchFilter) { window.alert('Pick a specific sport and batch above to use Mark All.'); return; }
    const targets = bulkTargets;
    if (!targets.length) return;
    const label = status === 'P' ? 'Present' : 'Absent';
    const alreadyAll = targets.every(r => records[r.key] === status);

    if (!alreadyAll) {
      const ok = window.confirm(`Mark all ${targets.length} ${sportFilter} student(s) as ${label} on ${date}?`);
      if (!ok) return;
      setRecords(prev => { const next = { ...prev }; targets.forEach(r => { next[r.key] = status; }); return next; });
      setLateMap(prev => { const next = { ...prev }; targets.forEach(r => { next[r.key] = false; }); return next; });
      const makeRows = () => targets.map(r => {
        const row = { academy_id: academyId, student_id: r.student.id, date, status, sport: r.sport, batch: r.batchLabel, marked_by: markedBy };
        if (!missingLatecomerCol.current) row.is_latecomer = false;
        return row;
      });
      let { error } = await supabase.from('attendance').upsert(makeRows(), { onConflict: 'academy_id,student_id,date,sport,batch' });
      if (error && !missingLatecomerCol.current && /is_latecomer/i.test(error.message || '')) {
        missingLatecomerCol.current = true;
        ({ error } = await supabase.from('attendance').upsert(makeRows(), { onConflict: 'academy_id,student_id,date,sport,batch' }));
      }
      if (error) { window.alert(`Couldn't save attendance: ${error.message}`); return; }
      logAttendance(`All ${sportFilter} students → ${label} on ${date}`);
    } else {
      const ok = window.confirm(`Remove ${label} mark for all ${sportFilter} students on ${date}?`);
      if (!ok) return;
      const clearedKeys = targets.map(r => r.key);
      setRecords(prev => { const next = { ...prev }; clearedKeys.forEach(k => { delete next[k]; }); return next; });
      // Deleted per-row (not a single bulk .in) since a student may have
      // another untouched enrollment on the same date that must survive.
      for (const r of targets) {
        const { error } = await supabase.from('attendance').delete()
          .eq('academy_id', academyId).eq('date', date).eq('student_id', r.student.id).eq('sport', r.sport).eq('batch', r.batchLabel);
        if (error) { window.alert(`Couldn't clear attendance for ${r.student.name}: ${error.message}`); return; }
      }
      logAttendance(`All ${label} cleared for ${sportFilter} on ${date}`);
    }
  };

  const dayCompleted = (sportFilter && batchFilter) ? isRegisterClosed(sportFilter, batchFilter) : false;

  const markAllDone = async () => {
    if (!sportFilter || !batchFilter) { window.alert('Pick a specific sport and batch above to close its register.'); return; }
    if (!students.length || dayCompleted || isFutureDate) return;
    const ok = window.confirm(
      `Close the ${sportFilter} / ${batchFilter} attendance register for ${date}?\n\nMarked students will be locked. Anyone marked Present afterward will be flagged as a latecomer. An admin can reopen it later if needed.`
    );
    if (!ok) return;
    setCompleting(true);
    try {
      let { error } = await supabase.from('attendance_day_status').upsert(
        { academy_id: academyId, date, sport: sportFilter, batch: batchFilter, completed: true, completed_at: new Date().toISOString() },
        { onConflict: 'academy_id,date,sport,batch' }
      );
      if (error && /batch|onConflict|constraint/i.test(error.message || '')) {
        // `batch` column/constraint not migrated in yet — fall back to the
        // older sport-only lock (still correct, just coarser-grained).
        ({ error } = await supabase.from('attendance_day_status').upsert(
          { academy_id: academyId, date, sport: sportFilter, completed: true, completed_at: new Date().toISOString() },
          { onConflict: 'academy_id,date,sport' }
        ));
      }
      if (error && /sport|onConflict|constraint/i.test(error.message || '')) {
        // Falls back further to the original whole-day lock if even the
        // sport column/constraint isn't there yet.
        ({ error } = await supabase.from('attendance_day_status').upsert(
          { academy_id: academyId, date, completed: true, completed_at: new Date().toISOString() },
          { onConflict: 'academy_id,date' }
        ));
      }
      if (error) throw error;
    } catch (err) {
      window.alert(`Couldn't close the register: ${err.message}`);
      setCompleting(false);
      return;
    }
    setDayStatusMap(m => ({ ...m, [dsKey(sportFilter, batchFilter)]: true }));
    setCompleting(false);
    logAttendance(`Register closed (${sportFilter} / ${batchFilter}) for ${date}`);
    setReloadKey(k => k + 1);
  };

  // Admin-only: reopen a closed register. Requires a reason, which is written
  // to attendance_register_unlocks for the audit trail before the lock itself
  // is removed. Deletes rather than flips `completed` back to false, so a
  // re-close later is a clean upsert and there's no stray "reopened" row
  // shape to special-case elsewhere.
  const [unlocking, setUnlocking] = useState(false);
  const unlockRegister = async () => {
    if (!isAdmin || !sportFilter || !batchFilter || !dayCompleted) return;
    const reason = window.prompt(
      `Reason for reopening ${sportFilter} / ${batchFilter} on ${date}?\n(required — this is logged in the audit trail)`
    );
    if (reason === null) return; // cancelled
    if (!reason.trim()) { window.alert('A reason is required to reopen the register.'); return; }
    setUnlocking(true);
    try {
      const { error: delErr } = await supabase.from('attendance_day_status').delete()
        .eq('academy_id', academyId).eq('date', date).eq('sport', sportFilter).eq('batch', batchFilter);
      if (delErr) throw delErr;
      const { error: logErr } = await supabase.from('attendance_register_unlocks').insert({
        academy_id: academyId, date, sport: sportFilter, batch: batchFilter,
        unlocked_by_id: appUser?.id || user?.id || null,
        unlocked_by_name: markedBy,
        reason: reason.trim(),
      });
      // A failed audit-log insert shouldn't trap the register in a closed
      // state that the delete above already opened — surface it, don't revert.
      if (logErr) console.error('Unlock audit log failed:', logErr);
    } catch (err) {
      window.alert(`Couldn't reopen the register: ${err.message}`);
      setUnlocking(false);
      return;
    }
    setDayStatusMap(m => {
      const next = { ...m };
      delete next[dsKey(sportFilter, batchFilter)];
      return next;
    });
    setUnlocking(false);
    logAttendance(`Register reopened (${sportFilter} / ${batchFilter}) for ${date} — reason: ${reason.trim()}`);
    setReloadKey(k => k + 1);
  };

  const presentCount = students.filter(r => records[r.key] === 'P').length;
  const absentCount = students.filter(r => records[r.key] === 'A').length;
  const notMarkedCount = students.length - presentCount - absentCount;

  const dateLabel = `${day} ${WEEKDAYS[dateObj.getDay()]}, ${MONTHS[month]} ${year}`;

  // ---- Export ----
  // exportGenericPdf(title, columns, rows[][], filename) and
  // exportGenericXlsx(rowObjects[], filename, sheetName) — real signatures
  // from src/lib/exporters.js (xlsx needs objects, not parallel arrays).
  const doExport = (kind) => {
    if (viewMode === 'day') {
      const columns = ['Roll No', 'Name', 'Sport', 'Batch', 'Status'];
      const rowObjs = students.map(r => ({
        'Roll No': r.student.roll_no, Name: r.student.name, Sport: r.sport, Batch: r.batchLabel,
        Status: records[r.key] === 'P' ? (lateMap[r.key] ? 'Present (Late)' : 'Present') : records[r.key] === 'A' ? 'Absent' : 'Not Marked',
      }));
      const title = `Attendance — ${dateLabel}`;
      const fname = `attendance_${date}`;
      if (kind === 'pdf') exportGenericPdf(title, columns, rowObjs.map(Object.values), `${fname}.pdf`);
      else exportGenericXlsx(rowObjs, `${fname}.xlsx`, 'Attendance');
    } else if (viewMode === 'month') {
      const columns = ['Roll No', 'Name', 'Sport', 'Batch', 'Present', 'Absent', '%'];
      const rowObjs = students.map(r => {
        const agg = periodRows[r.key] || { present: 0, absent: 0 };
        const classDays = classDaysByKey[dsKey(r.sport, r.batchLabel)] || 0;
        const pct = classDays ? Math.round((agg.present / classDays) * 100) : 0;
        return { 'Roll No': r.student.roll_no, Name: r.student.name, Sport: r.sport, Batch: r.batchLabel, Present: agg.present, Absent: agg.absent, '%': `${pct}%` };
      });
      const title = `Attendance Summary — ${MONTHS[month]} ${year}`;
      const fname = `attendance_${year}-${String(month + 1).padStart(2, '0')}`;
      if (kind === 'pdf') exportGenericPdf(title, columns, rowObjs.map(Object.values), `${fname}.pdf`);
      else exportGenericXlsx(rowObjs, `${fname}.xlsx`, 'Attendance');
    } else {
      const columns = ['Month', 'Class Days', 'Present', 'Absent'];
      const rowObjs = MONTHS
        .map((mLabel, i) => {
          const row = yearSummary[i] || { days: new Set(), p: 0, a: 0 };
          return { Month: mLabel, 'Class Days': row.days.size, Present: row.p, Absent: row.a };
        })
        .filter(r => r['Class Days'] > 0);
      const title = `Attendance Summary — ${year}`;
      const fname = `attendance_${year}`;
      if (kind === 'pdf') exportGenericPdf(title, columns, rowObjs.map(Object.values), `${fname}.pdf`);
      else exportGenericXlsx(rowObjs, `${fname}.xlsx`, 'Attendance');
    }
  };


  // ---- Scroll-driven show/hide of the sport/batch/status/sort row only —
  // the search box, date card, and summary row stay put, matching the HTML app. ----
  const updateScrollArrow = (el) => {
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight > 8;
    // Generous tolerance (~one row) so the arrow reliably disappears before
    // the last item — it was staying visible a few px short of true bottom
    // on real devices and physically blocking taps on whatever sits there
    // (e.g. the Done button), since it's a fixed-position overlay.
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
    setShowScrollArrow(scrollable && !atBottom);
  };

  const handleScroll = (e) => {
    const el = e.currentTarget;
    updateScrollArrow(el);
  };

  // Re-check arrow visibility whenever the rendered content changes size
  // (view switch, data load, filtering) — not just on manual scroll.
  useEffect(() => {
    updateScrollArrow(listScrollRef.current);
  }, [dayStudents, periodRows, yearSummary, loading, viewMode]);

  const scrollToBottom = () => {
    const el = listScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }); // instant, not smooth
  };

  const DateArrowGroup = ({ onPrev, onNext, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 30%', minWidth: 92 }}>
      <button className="at-btn" style={arrowBtnStyle} onClick={onPrev} aria-label="Previous"><Icon name="chevronLeft" size={15} /></button>
      {children}
      <button className="at-btn" style={arrowBtnStyle} onClick={onNext} aria-label="Next"><Icon name="chevronRight" size={15} /></button>
    </div>
  );

  const yearHasData = Object.values(yearSummary).some(r => (r?.days?.size || 0) > 0);
  const yearClassDays = Object.values(yearSummary).reduce((sum, r) => sum + (r?.days?.size || 0), 0);

  const statusLabel = STATUS_OPTIONS.find(o => o.v === statusFilter)?.l;
  const sortLabel = SORT_OPTIONS.find(o => o.v === sortBy)?.l;

  // Per-tab access gate — after all hooks above, before any early return,
  // so Rules of Hooks holds. Staff without the Attendance tab granted
  // (Staff Users) land here instead of the register.
  if (!canViewAttendance) {
    return (
      <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ display: 'flex', color: 'var(--gray)', marginBottom: 10 }}><Icon name="lock" size={32} stroke={1.75} /></div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Attendance</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  const currentSort = SORT_OPTIONS.find(o => o.v === sortBy);
  const dateTitle = viewMode === 'year' ? String(year) : viewMode === 'month' ? `${MONTHS[month]} ${year}` : dateLabel;
  const markAllHint = (!sportFilter || !batchFilter) ? 'Pick a specific sport and batch to use Mark All' : undefined;
  const checkLabelStyle = (on, accent) => ({
    flex: 'none', width: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 34, padding: 0, borderRadius: 9, whiteSpace: 'nowrap', boxSizing: 'border-box',
    border: `1px solid ${on ? accent : 'var(--border)'}`, background: on ? `${accent}14` : 'var(--card)',
    color: on ? accent : '#1A336A', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'background-color .15s ease, border-color .15s ease',
  });
  const statTile = (icon, n, label, color) => (
    <div title={label} aria-label={`${label}: ${n}`} role="img" style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, color, fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
      <Icon name={icon} size={15} /> {n}
    </div>
  );

  return (
    <div className="page active at-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'inherit' }}>
      <style>{ATTENDANCE_CSS}</style>

      {/* Header: title + PDF / Excel / Import */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
          <Icon name="calendarCheck" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>Attendance</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {canExportAttendance && hasFeature('has_reports') && (
            <button className="at-btn at-round" style={actionBtnStyle(false)} onClick={() => setShowDownload(true)} aria-label="Download attendance" title="Download"><Icon name="download" size={18} /></button>
          )}
          {canExportAttendance && !hasFeature('has_reports') && (() => {
            const target = cheapestPlanWithFeature('has_reports');
            const msg = target ? `Upgrade to ${target.name} to unlock exports` : 'Exports not available on your plan';
            return (
              <button className="at-btn at-round" style={actionBtnStyle(true)} disabled aria-label={msg} title={msg}>
                <Icon name="lock" size={16} />
              </button>
            );
          })()}
          {canImportAttendance && hasFeature('has_bulk_import') && (
            <button className="at-btn at-round" style={actionBtnStyle(false)} onClick={() => setShowImport(true)} aria-label="Import attendance" title="Import"><Icon name="upload" size={18} /></button>
          )}
          {canImportAttendance && !hasFeature('has_bulk_import') && (() => {
            const target = cheapestPlanWithFeature('has_bulk_import');
            const msg = target ? `Upgrade to ${target.name} to unlock bulk import` : 'Import not available on your plan';
            return (
              <button className="at-btn at-round" style={actionBtnStyle(true)} disabled aria-label={msg} title={msg}>
                <Icon name="lock" size={16} />
              </button>
            );
          })()}
        </div>
      </div>

      {/* Date navigator — header row always visible; filters, date arrows and
          view-mode buttons live in the collapsible panel (panelOpen). */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '4px 10px', marginBottom: 6, boxShadow: '0 1px 2px rgba(16,32,64,.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', minHeight: 36 }}
          onClick={() => setPanelOpen(p => !p)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ display: 'flex', color: '#1A336A' }} title="Select date" aria-label="Select date"><Icon name="calendar" size={18} /></span>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#182238', whiteSpace: 'nowrap' }}>{dateTitle}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 7, background: 'rgba(91,124,196,.14)', color: '#1A336A', textTransform: 'capitalize' }}>{viewMode}</span>
          </div>
          <button className="at-btn" style={{ ...arrowBtnStyle, border: 'none', background: 'var(--card2)', borderRadius: '50%', width: 28 }}
            aria-label={panelOpen ? 'Collapse date and filter options' : 'Expand date and filter options'} aria-expanded={panelOpen}
            onClick={(e) => { e.stopPropagation(); setPanelOpen(p => !p); }}>
            <Icon name={panelOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        </div>

        {panelOpen && (
          <div className="at-panel" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Sport | Batch | Status | Sort */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ display: 'flex', color: '#5B7CC4', flexShrink: 0, padding: '0 2px' }} aria-hidden="true"><Icon name="filter" size={16} /></span>
              <button className="at-btn at-chip" style={chipStyle(!!sportFilter)} onClick={() => setPopup('sport')} aria-haspopup="dialog" aria-label="Filter by sport" title="Filter by sport">
                <span style={{ whiteSpace: 'nowrap' }}>{sportFilter || 'Sport'}</span>
                <Icon name="chevronDown" size={13} />
              </button>
              <button className="at-btn at-chip" style={chipStyle(!!batchFilter)} onClick={() => setPopup('batch')} aria-haspopup="dialog" aria-label="Filter by batch" title="Filter by batch">
                <span style={{ whiteSpace: 'nowrap' }}>{batchFilter || 'Batch'}</span>
                <Icon name="chevronDown" size={13} />
              </button>
              {viewMode === 'day' && (
                <button className="at-btn at-chip" style={chipStyle(statusFilter !== 'all')} onClick={() => setPopup('status')} aria-haspopup="dialog" aria-label="Filter by status">
                  <span style={{ whiteSpace: 'nowrap' }}>{statusFilter === 'all' ? 'Status' : statusLabel}</span>
                  <Icon name="chevronDown" size={13} />
                </button>
              )}
              <button className="at-btn at-chip" style={chipStyle(false)} onClick={() => setPopup('sort')} aria-haspopup="dialog" aria-label={`Sort by ${currentSort?.l || ''}`}>
                <span style={{ whiteSpace: 'nowrap' }}>{currentSort?.short || 'Sort'}</span>
                {currentSort?.dir && <span style={{ display: 'flex', color: '#5B7CC4' }}><Icon name={currentSort.dir} size={12} stroke={2.4} /></span>}
                <Icon name="chevronDown" size={13} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <DateArrowGroup onPrev={() => shiftDay(-1)} onNext={() => shiftDay(1)}>
                <button className="at-btn at-chip" style={{ ...chipStyle(false), height: 30, borderRadius: 8 }} onClick={() => setPopup('day')} aria-label="Select day">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{day} {WEEKDAYS[dateObj.getDay()]}</span>
                </button>
              </DateArrowGroup>
              <DateArrowGroup onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)}>
                <button className="at-btn at-chip" style={{ ...chipStyle(false), height: 30, borderRadius: 8 }} onClick={() => setPopup('month')} aria-label="Select month">
                  {MONTHS[month]}
                </button>
              </DateArrowGroup>
              <DateArrowGroup onPrev={() => shiftYear(-1)} onNext={() => shiftYear(1)}>
                <button className="at-btn at-chip" style={{ ...chipStyle(false), height: 30, borderRadius: 8 }} onClick={() => setPopup('year')} aria-label="Select year">
                  {year}
                </button>
              </DateArrowGroup>
            </div>

            {/* View mode — segmented control */}
            <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--card2)', border: '1px solid var(--border)' }}>
              {['day', 'month', 'year'].map(m => (
                <button key={m} className="at-btn" aria-pressed={viewMode === m}
                  style={{
                    flex: 1, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                    background: viewMode === m ? '#1A336A' : 'transparent', color: viewMode === m ? '#fff' : '#1A336A',
                  }}
                  onClick={() => setViewMode(m)}>
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {popup === 'sport' && (
        <FilterPopup title="Select Sport" onClose={() => setPopup(null)}>
          <RadioRow name="sportsel" checked={!sportFilter} onChange={() => { setSportFilter(''); setBatchFilter(''); setPopup(null); }} label="All Sports" />
          {visibleSports.map(s => (
            <RadioRow key={s.id} name="sportsel" checked={sportFilter === s.name} onChange={() => { setSportFilter(s.name); setBatchFilter(''); setPopup(null); }} label={s.name} />
          ))}
        </FilterPopup>
      )}

      {popup === 'batch' && (
        <FilterPopup title="Select Batch" onClose={() => setPopup(null)}>
          <RadioRow name="batchsel" checked={!batchFilter} onChange={() => { setBatchFilter(''); setPopup(null); }} label="All Batches" />
          {batchesForSport.map(b => (
            <RadioRow key={b.id} name="batchsel" checked={batchFilter === b.batchLabel} onChange={() => { setBatchFilter(b.batchLabel); setSportFilter(b.sport); setPopup(null); }} label={b.batchLabel} />
          ))}
        </FilterPopup>
      )}

      {popup === 'status' && (
        <FilterPopup title="Filter by Status" onClose={() => setPopup(null)}>
          {STATUS_OPTIONS.map(o => (
            <RadioRow key={o.v} name="statussel" checked={statusFilter === o.v} onChange={() => { setStatusFilter(o.v); setPopup(null); }} label={o.l} />
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

      {popup === 'day' && (
        <FilterPopup title="Select Day" onClose={() => setPopup(null)}>
          {Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map(d => (
            <RadioRow key={d} name="daysel" checked={day === d} onChange={() => { setDay(d); setPopup(null); }} label={`${d} ${WEEKDAYS[new Date(year, month, d).getDay()]}`} />
          ))}
        </FilterPopup>
      )}

      {popup === 'month' && (
        <FilterPopup title="Select Month" onClose={() => setPopup(null)}>
          {MONTHS.map((m, i) => (
            <RadioRow key={m} name="monthsel" checked={month === i} onChange={() => { setMonth(i); setPopup(null); }} label={m} />
          ))}
        </FilterPopup>
      )}

      {popup === 'year' && (
        <FilterPopup title="Select Year" onClose={() => setPopup(null)}>
          {Array.from({ length: 8 }, (_, i) => year - 4 + i).map(y => (
            <RadioRow key={y} name="yearsel" checked={year === y} onChange={() => { setYear(y); setPopup(null); }} label={String(y)} />
          ))}
        </FilterPopup>
      )}

      {/* Search box — always visible, never hides on scroll */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 12, display: 'flex', color: 'var(--gray)', pointerEvents: 'none' }}>
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          className="at-search"
          placeholder="Search by name or roll number..."
          aria-label="Search students by name or roll number"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={selectAllOnTap}
          onClick={selectAllOnTap}
          style={{
            width: '100%', height: 38, padding: '0 38px 0 36px', boxSizing: 'border-box', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card2)', fontSize: 13.5, fontWeight: 400,
            color: '#182238', outline: 'none', fontFamily: 'inherit',
          }}
        />
        {search && (
          <button type="button" className="at-btn" onClick={() => setSearch('')} aria-label="Clear search"
            style={{ position: 'absolute', right: 7, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'var(--border)', color: 'var(--gray)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={13} stroke={2.4} />
          </button>
        )}
      </div>

      {/* Summary — always visible, doesn't hide on scroll */}
      {viewMode === 'day' ? (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px 4px 10px', marginBottom: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,32,64,.05)' }}>
          {/* Summary tiles — left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, padding: '0 2px' }}>
            {statTile('checkCircle', presentCount, 'Present', '#1A336A')}
            {statTile('xCircle', absentCount, 'Absent', '#DC2626')}
            {statTile('clock', notMarkedCount, 'Pending', '#6B7385')}
          </div>
          {/* All Present / All Absent — right, same line */}
          {!isFutureDate && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
              <label className="at-check" style={checkLabelStyle(allPChecked, '#1A336A')} title={markAllHint || 'Mark all Present'}>
                <input type="checkbox" checked={allPChecked} onChange={() => markAll('P')} aria-label="All Present" style={{ width: 13, height: 13, margin: 0, accentColor: '#1A336A', cursor: 'pointer', flexShrink: 0 }} /> P
              </label>
              <label className="at-check" style={checkLabelStyle(allAChecked, '#DC2626')} title={markAllHint || 'Mark all Absent'}>
                <input type="checkbox" checked={allAChecked} onChange={() => markAll('A')} aria-label="All Absent" style={{ width: 13, height: 13, margin: 0, accentColor: '#DC2626', cursor: 'pointer', flexShrink: 0 }} /> A
              </label>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--gray)', margin: '2px 2px 6px', flexShrink: 0 }}>
          {students.length} student(s) · {viewMode === 'month' ? monthClassDays : yearClassDays} class day(s) · showing {viewMode === 'month' ? `${MONTHS[month]} ${year}` : `${year}`} summary
        </div>
      )}

      <div ref={listScrollRef} className="at-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 60, marginTop: 2, overscrollBehavior: 'contain' }} onScroll={handleScroll}>
        {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20 }}>Loading…</div>}

        {!loading && viewMode === 'day' && isFutureDate && (
          <div style={{ background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', color: '#B45309' }}><Icon name="lock" size={18} /></span>
            <div style={{ fontSize: 12.5, color: '#92400E', fontWeight: 600 }}>Future date — attendance cannot be marked yet.</div>
          </div>
        )}

        {!loading && viewMode === 'day' && !isFutureDate && dayStudents.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: 30 }}>No students found.</div>
        )}
        {!loading && viewMode !== 'day' && students.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: 30 }}>No students found.</div>
        )}

        {!loading && viewMode === 'day' && !isFutureDate && dayStudents.map(r => {
          const status = records[r.key];
          const isLate = status === 'P' && !!lateMap[r.key];
          const rowDone = !!dayStatusMap[r.sport];
          const locked = rowDone && (status === 'A' || (status === 'P' && !isLate));
          const pClass = 'at-pa' + (status === 'P' ? (isLate ? ' on-late' : ' on-p') : '');
          const aClass = 'at-pa' + (status === 'A' ? ' on-a' : '');
          const pTitle = locked ? 'Locked — register closed' : (status === 'P' ? (isAdmin ? 'Click to clear' : 'Marked Present') : (rowDone ? 'Mark as latecomer (Present)' : 'Mark Present'));
          const aTitle = locked ? 'Locked — register closed' : (status === 'A' ? (isAdmin ? 'Click to clear' : 'Marked Absent') : 'Mark Absent');
          return (
            <div key={r.key} className="at-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', marginBottom: 5 }}>
              <RollBadge rollNo={r.student.roll_no} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#182238', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.student.name}
                  {isLate && (
                    <span style={{ background: 'rgba(234,138,26,.14)', color: '#B45309', border: '1px solid rgba(234,138,26,.4)', borderRadius: 5, fontSize: 9, fontWeight: 700, padding: '1px 5px', marginLeft: 6 }}>LATE</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--gray)' }}>
                  {sportFilter ? r.batchLabel : `${r.sport} · ${r.batchLabel}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className={pClass} title={pTitle} aria-label={`Mark ${r.student.name} present`} aria-pressed={status === 'P'} onClick={() => setStatus(r, 'P')}>P</button>
                <button className={aClass} title={aTitle} aria-label={`Mark ${r.student.name} absent`} aria-pressed={status === 'A'} onClick={() => setStatus(r, 'A')}>A</button>
              </div>
            </div>
          );
        })}

        {!loading && viewMode === 'month' && students.map(r => {
          const agg = periodRows[r.key] || { present: 0, absent: 0 };
          const classDays = classDaysByKey[dsKey(r.sport, r.batchLabel)] || 0;
          const pct = classDays ? Math.round((agg.present / classDays) * 100) : 0;
          return (
            <div key={r.key} className="at-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 6 }}>
              <RollBadge rollNo={r.student.roll_no} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#182238' }}>{r.student.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                  {sportFilter ? r.batchLabel : `${r.sport} · ${r.batchLabel}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div><span style={{ color: '#1A336A', fontWeight: 700 }}>{agg.present}P</span> · <span style={{ color: '#DC2626', fontWeight: 700 }}>{agg.absent}A</span></div>
                <div style={{ color: 'var(--gray)' }}>{pct}%</div>
              </div>
            </div>
          );
        })}

        {!loading && viewMode === 'year' && !yearHasData && (
          <div style={{ textAlign: 'center', color: 'var(--gray)', fontSize: 13, padding: 30 }}>No attendance records for {year}.</div>
        )}
        {!loading && viewMode === 'year' && MONTHS.map((mLabel, i) => {
          const row = yearSummary[i];
          if (!row || row.days.size === 0) return null;
          const isExpanded = expandedMonth === i;
          const sortedDates = isExpanded ? Object.keys(row.byDate).sort() : [];
          return (
            <div key={mLabel} className="at-card" style={{ padding: 0, marginBottom: 6, overflow: 'hidden' }}>
              <div
                role="button" tabIndex={0} aria-expanded={isExpanded}
                onClick={() => setExpandedMonth(isExpanded ? null : i)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedMonth(isExpanded ? null : i); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                <div style={{ width: 42, fontWeight: 700, color: '#1A336A', fontSize: 13, flexShrink: 0 }}>{mLabel}</div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--gray)' }}>{row.days.size} class day{row.days.size === 1 ? '' : 's'}</div>
                <div style={{ display: 'flex', gap: 10, fontSize: 12.5, fontWeight: 700 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#1A336A' }}><Icon name="checkCircle" size={14} /> {row.p}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#DC2626' }}><Icon name="xCircle" size={14} /> {row.a}</span>
                </div>
                <span style={{ display: 'flex', color: 'var(--gray)', flexShrink: 0 }}><Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={16} /></span>
              </div>
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border, #e5e5e5)' }}>
                  {sortedDates.map(dISO => {
                    const d = row.byDate[dISO];
                    const dObj = new Date(dISO + 'T00:00:00');
                    const label = `${dObj.getDate()} ${WEEKDAYS[dObj.getDay()]}`;
                    return (
                      <div key={dISO} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 54px', fontSize: 12, borderTop: '1px solid var(--border, #f0f0f0)' }}>
                        <div style={{ flex: 1, color: 'var(--gray)' }}>{label}</div>
                        <div style={{ display: 'flex', gap: 10, fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#1A336A' }}><Icon name="checkCircle" size={13} /> {d.p}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#DC2626' }}><Icon name="xCircle" size={13} /> {d.a}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {!loading && isAdmin && viewMode === 'day' && !isFutureDate && students.length > 0 && (
          !sportFilter || !batchFilter ? (
            <div style={{ fontSize: 12, color: 'var(--graydk)', marginTop: 10, padding: '9px 10px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ display: 'flex', color: '#5B7CC4', marginTop: 1 }}><Icon name="info" size={15} /></span>
              <span>Pick a specific <b>sport</b> and <b>batch</b> above to close its register (Done) and flag latecomers.</span>
            </div>
          ) : dayCompleted ? (
            <>
              <button className="btn at-btn" disabled style={{ width: '100%', marginTop: 10, padding: 12, background: 'var(--card2)', color: 'var(--gray)', border: '1px solid var(--border)', cursor: 'not-allowed', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12 }}>
                <Icon name="lock" size={16} /> Register Closed
              </button>
              <div style={{ fontSize: 11, color: 'var(--graydk)', marginTop: 5, padding: '0 4px' }}>
                Closed for {sportFilter} / {batchFilter}. Marked students are locked; new Present marks show as latecomers.
              </div>
              {isAdmin && (
                <button
                  className="btn at-btn"
                  onClick={unlockRegister}
                  disabled={unlocking}
                  style={{ width: '100%', marginTop: 8, padding: 10, background: 'transparent', color: '#DC2626', border: '1px solid rgba(220,38,38,.35)', fontWeight: 600, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12 }}
                >
                  <Icon name="unlock" size={15} /> {unlocking ? 'Reopening…' : 'Reopen Register (requires reason)'}
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn btn-primary at-btn" style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12 }} onClick={markAllDone} disabled={completing}>
                <Icon name="checkCircle" size={17} /> {completing ? 'Marking…' : 'Done — Close Register'}
              </button>
              <div style={{ fontSize: 11, color: 'var(--graydk)', marginTop: 5, padding: '0 4px' }}>
                Tap P/A again to clear a mark. Closing locks in {sportFilter}'s attendance for the day.
              </div>
            </>
          )
        )}
      </div>

      {/* Scroll-to-bottom: jumps the list to its end (same behaviour as before) */}
      <button
        className="at-btn"
        onClick={scrollToBottom}
        aria-label="Scroll to bottom"
        title="Scroll to bottom"
        style={{
          position: 'absolute', left: '50%', bottom: 78, transform: 'translateX(-50%)', zIndex: 20,
          width: 36, height: 36, borderRadius: '50%', padding: 0,
          background: '#1A336A', color: '#fff', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 3px 10px rgba(26,51,106,.32)', cursor: 'pointer',
          opacity: showScrollArrow ? 1 : 0, pointerEvents: showScrollArrow ? 'auto' : 'none',
          transition: 'opacity .2s',
        }}
      >
        <Icon name="chevronDown" size={18} stroke={2.4} />
      </button>

      {showDownload && (
        <FilterPopup title="Download as" onClose={() => setShowDownload(false)}>
          {[['pdf', 'fileText', 'PDF'], ['xlsx', 'sheet', 'Excel']].map(([kind, icon, label]) => (
            <button
              key={kind}
              className="at-btn at-chip"
              onClick={() => { setShowDownload(false); doExport(kind); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ display: 'flex', color: '#1A336A' }}><Icon name={icon} size={20} /></span> {label}
            </button>
          ))}
        </FilterPopup>
      )}

      {showImport && (
        <ImportAttendanceModal
          academyId={academyId}
          existingStudents={visibleStudents}
          sportFilter={sportFilter}
          batchFilter={batchFilter}
          markedBy={markedBy}
          onClose={() => setShowImport(false)}
          onImported={() => { refresh(); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
}
