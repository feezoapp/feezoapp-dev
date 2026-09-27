import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import StatDrilldownModal from '../components/StatDrilldownModal';

function CollectedIcon({ size = 24, color = '#36B89C' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 29h32a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V29z" />
      <path d="M22 29l7-7h25a4 4 0 0 1 4 4v3" />
      <path d="M44 37h14v11H44a5.5 5.5 0 0 1 0-11z" />
      <path d="M50 40v5" />
      <path d="M47.5 41.5c1.2-1.3 4.1-1.3 5.1.2 1.1 1.7-1.2 3-3 3.6-1.8.6-2.8 1.4-2.2 2.8.7 1.6 3.8 1.7 5.1.1" />
    </svg>
  );
}

function PendingIcon({ size = 24, color = '#F5B82E' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M27 21h25v25l-4 4-4-4-4 4-4-4-5 4V21z" />
      <path d="M33 29h13" />
      <path d="M33 35h10" />
      <circle cx="49" cy="51" r="11" />
      <path d="M49 45v6l4 3" />
    </svg>
  );
}

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload || !payload.length) return null;
  const key1 = mode === 'attendance' ? 'present' : 'strength';
  const key2 = mode === 'attendance' ? 'absent' : 'dropped';
  const label1 = mode === 'attendance' ? 'Present' : 'Joined';
  const label2 = mode === 'attendance' ? 'Absent' : 'Dropped';
  const p1 = payload.find(p => p.dataKey === key1);
  const p2 = payload.find(p => p.dataKey === key2);
  if (!p1 && !p2) return null;
  return (
    <div style={{ background: 'var(--card)', borderRadius: 8, padding: '7px 11px', fontSize: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>Day {label}</div>
      {p1 && <div><span style={{ color: p1.color }}>●</span> {label1}: {p1.value}</div>}
      {p2 && <div><span style={{ color: p2.color }}>●</span> {label2}: {p2.value}</div>}
    </div>
  );
}

// Same centered popup used by StudentsTab's / AttendanceTab's Sport/Batch/Sort
// filters — a dark overlay + a card of radio rows, closing itself on selection.
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

// One scrollable wheel column (used for both the month list and the year list
// in MonthYearPickerModal). Snaps to the item nearest the center on scroll end.
const WHEEL_ITEM_H = 36;
const WHEEL_VISIBLE_ROWS = 5;
const WHEEL_PAD = Math.floor(WHEEL_VISIBLE_ROWS / 2);

function WheelColumn({ items, selectedIndex, onChange }) {
  const scrollRef = useRef(null);
  const settleTimer = useRef(null);
  const programmatic = useRef(false);

  // Keep the scroll position in sync when selectedIndex changes from outside
  // (initial open, or a value picked by tapping a row directly).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = selectedIndex * WHEEL_ITEM_H;
    if (Math.abs(el.scrollTop - target) > 1) {
      programmatic.current = true;
      el.scrollTo({ top: target, behavior: 'smooth' });
      setTimeout(() => { programmatic.current = false; }, 260);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  const handleScroll = () => {
    if (programmatic.current) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / WHEEL_ITEM_H)));
      if (idx !== selectedIndex) onChange(idx);
      el.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
    }, 110);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        flex: 1, height: WHEEL_ITEM_H * WHEEL_VISIBLE_ROWS, overflowY: 'auto',
        scrollSnapType: 'y mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}
    >
      <style>{'div::-webkit-scrollbar{display:none}'}</style>
      <div style={{ height: WHEEL_ITEM_H * WHEEL_PAD }} />
      {items.map((label, i) => {
        const isSel = i === selectedIndex;
        return (
          <div
            key={label + i}
            onClick={() => onChange(i)}
            style={{
              height: WHEEL_ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
              scrollSnapAlign: 'center', cursor: 'pointer',
              fontSize: isSel ? 15.5 : 14, fontWeight: isSel ? 700 : 500,
              color: isSel ? '#1A336A' : 'rgba(20,30,55,.4)',
              transition: 'color .15s ease, font-size .15s ease',
            }}
          >
            {label}
          </div>
        );
      })}
      <div style={{ height: WHEEL_ITEM_H * WHEEL_PAD }} />
    </div>
  );
}

// Custom "Set month" picker: a compact two-column wheel (months / years)
// styled to match the app's navy/blue theme, replacing the native
// <input type="month"> control (which shows the generic OS picker).
function MonthYearPickerModal({ month, year, onCancel, onClear, onSet }) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const nowYear = new Date().getFullYear();
  const YEARS = useMemo(() => Array.from({ length: 21 }, (_, i) => nowYear - 10 + i), [nowYear]);

  const [mIdx, setMIdx] = useState(month);
  const [yIdx, setYIdx] = useState(Math.max(0, YEARS.indexOf(year)));

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 18, padding: '16px 14px 12px', width: '100%', maxWidth: 300,
          boxShadow: '0 12px 34px rgba(10,18,35,.28)',
        }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1A336A', marginBottom: 8, textAlign: 'center' }}>
          Set month
        </div>

        <div style={{ position: 'relative' }}>
          {/* subtle blue accent band marking the centered / selected row */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: WHEEL_ITEM_H * WHEEL_PAD, height: WHEEL_ITEM_H,
            background: 'rgba(91,124,196,.12)', borderRadius: 10, pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex' }}>
            <WheelColumn items={MONTHS} selectedIndex={mIdx} onChange={setMIdx} />
            <WheelColumn items={YEARS.map(String)} selectedIndex={yIdx} onChange={setYIdx} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={onClear}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 10, border: '1px solid #e0e5ee', background: '#fff',
              color: '#6b7385', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 10, border: '1px solid #e0e5ee', background: '#fff',
              color: '#6b7385', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSet(mIdx, YEARS[yIdx])}
            style={{
              flex: 1.2, padding: '9px 0', borderRadius: 10, border: 'none', background: '#1A336A',
              color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 3px 10px rgba(26,51,106,.35)',
            }}
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}

// Small circular percentage ring used on the 4 dashboard tiles. Pure
// presentation — takes a 0-100 number and draws a progress arc + centered
// percentage label using the tile's own white text color.
function PercentRing({ pct, size = 40, strokeWidth = 4, ringColor = '#fff', trackColor = 'rgba(255,255,255,.28)' }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth={strokeWidth}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="51%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.26} fontWeight={800} fill={ringColor}>
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const toIsoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Supabase/PostgREST caps any single .select() at 1000 rows by default. A
// busy academy's month of attendance across every sport/batch can easily
// exceed that — this was confirmed to silently truncate whole days out of
// the Attendance chart (Present/Absent) while leaving the Strength chart
// unaffected, since Strength never reads `allAttendance` at all. Matches
// AttendanceTab.jsx / FeesTab.jsx's identical fetchAllRows helper.
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

// Trimmed + lowercased comparison so a stray space or casing difference
// between a sport/batch on a student's enrollment and the one stored on an
// attendance/fee row doesn't cause a silent mismatch — matches norm() in
// AttendanceTab.jsx and FeesTab.jsx exactly, kept in sync deliberately.
const norm = (v) => (v || '').toString().trim().toLowerCase();
// Composite key per enrollment (student + sport + batch) — same pattern as
// AttendanceTab/FeesTab, so a student with two enrollments (same or
// different sport) is tracked as two independent rows, never merged.
const keyFor = (studentId, sport, batchLabel) => `${studentId}::${norm(sport)}::${norm(batchLabel)}`;

// Returns 'unpaid' | 'partial' | 'paid' — identical logic to feeStatus() in
// FeesTab.jsx, kept in sync deliberately so Home's numbers always agree with
// the Fees tab. A scholarship row is always fully settled regardless of the
// amount fields.
function feeStatus(fee) {
  if (!fee) return 'unpaid';
  if (fee.is_scholarship) return 'paid';
  const due = parseInt(fee.amount_due, 10);
  const paid = parseInt(fee.amount, 10) || 0;
  if (!due || isNaN(due)) return (fee.status === 'paid' && paid > 0) ? 'paid' : 'unpaid';
  if (paid <= 0) return 'unpaid';
  if (paid >= due) return 'paid';
  return 'partial';
}

// A student owes fees for a given *enrollment* (sport + batch) for a given
// month if they were enrolled on/before that month — no longer requires at
// least one Present attendance record that month (removed per request).
// NOTE: this now intentionally differs from isEligible() in FeesTab.jsx,
// which still has the attendance requirement — so Home's Fee Pending count
// may no longer match the Fees tab's count.
function isEligible(student, year, month, attendanceByStudent, sport, batchLabel) {
  if (student.join_date) {
    const checkEnd = toIsoDate(new Date(year, month, 0)); // last day of month
    if (student.join_date > checkEnd) return false;
  }
  return true;
}

export default function HomeTab() {
  const { visibleStudents, visibleSports, visibleBatches } = useAcademyData();
  const { academyId, isAdmin, canViewContactHome, canExportHome, canViewHome } = useAuth();
  const [dataLoaded, setDataLoaded] = useState(false);
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [sportFilter, setSportFilter] = useState('ALL');
  const [batchFilter, setBatchFilter] = useState('ALL');
  const [popup, setPopup] = useState(null); // 'sport' | 'batch' | null
  const [fees, setFees] = useState([]);
  const [allAttendance, setAllAttendance] = useState([]);
  const [chartMode, setChartMode] = useState('strength'); // 'attendance' | 'strength'
  const [drilldown, setDrilldown] = useState(null);

  // Date range for the selected month: 1st -> today (if current month) or end of month (past months)
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const isFutureMonth = new Date(year, month, 1) > today;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const endDay = isFutureMonth ? 0 : isCurrentMonth ? today.getDate() : daysInMonth;
  const dateRange = Array.from({ length: endDay }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  // f.month is stored as ISO "YYYY-MM" (confirmed against live data), so fee
  // rows can be matched to the browsed month with an exact, indexable
  // comparison — no text pattern matching needed.
  const monthLabelShort = new Date(year, month, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });
  const monthIso = `${year}-${String(month + 1).padStart(2, '0')}`;
  const feeMatchesMonth = (f) => f.month === monthIso;

  // Fees + attendance fetched together under one loader so the ring shows
  // once and hides once, instead of flickering twice for two separate calls.
  // Both are now scoped to the browsed month only (not the academy's full
  // history) — attendance via a date range, fees via an exact month match —
  // and refetch whenever month/year changes.
  // IMPORTANT: sport + batch are fetched too — without them there's no way
  // to scope attendance/eligibility to a specific enrollment, which was
  // causing multi-sport students' records to bleed across sport filters.
  useEffect(() => {
    (async () => {
      if (!academyId) { setFees([]); setAllAttendance([]); setDataLoaded(true); return; }
      try {
        const monthStartIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const rangeEndIso = isFutureMonth
          ? monthStartIso
          : `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const [feesRes, attendanceData] = await Promise.all([
          supabase.from('fees').select('*').eq('academy_id', academyId).eq('month', monthIso),
          fetchAllRows(() =>
            supabase.from('attendance').select('date,status,student_id,sport,batch')
              .eq('academy_id', academyId)
              .gte('date', monthStartIso)
              .lte('date', rangeEndIso)
          ),
        ]);
        setFees(feesRes.data || []);
        setAllAttendance(attendanceData || []);
      } catch (err) {
        console.error('HomeTab: failed to load dashboard data', err);
      } finally {
        setDataLoaded(true);
      }
    })();
  }, [academyId, month, year]);

  // Realtime sync: another staff member marking attendance or recording a
  // payment should show up here without a manual refresh. Each event's
  // payload already carries the changed row, so we merge/remove it locally
  // instead of re-querying — and only apply it if the row falls within the
  // currently browsed month, to stay consistent with what was actually
  // fetched above (out-of-month changes are ignored, not merged in).
  useEffect(() => {
    if (!academyId) return;

    const monthStartIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const rangeEndIso = isFutureMonth
      ? monthStartIso
      : `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const targetMonthIso = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Attendance rows are fetched without `id` (only the columns HomeTab
    // needs), so local rows are matched by the same composite key as the
    // unique index (student_id, date, sport, batch) instead of `id`.
    const attKey = (r) => `${r.student_id}|${r.date}|${norm(r.sport)}|${norm(r.batch)}`;

    const applyFeeEvent = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || row.month !== targetMonthIso) return; // different month — not in view, ignore
      setFees(prev => {
        if (payload.eventType === 'DELETE') return prev.filter(f => f.id !== row.id);
        const idx = prev.findIndex(f => f.id === row.id);
        if (idx === -1) return [...prev, row];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
    };

    const applyAttendanceEvent = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || row.date < monthStartIso || row.date > rangeEndIso) return; // outside browsed range, ignore
      const thin = { date: row.date, status: row.status, student_id: row.student_id, sport: row.sport, batch: row.batch };
      const k = attKey(thin);
      setAllAttendance(prev => {
        const idx = prev.findIndex(r => attKey(r) === k);
        if (payload.eventType === 'DELETE') {
          if (idx === -1) return prev;
          const next = prev.slice();
          next.splice(idx, 1);
          return next;
        }
        if (idx === -1) return [...prev, thin];
        const next = prev.slice();
        next[idx] = thin;
        return next;
      });
    };

    const channel = supabase
      .channel(`home-tab-${academyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fees', filter: `academy_id=eq.${academyId}` }, applyFeeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `academy_id=eq.${academyId}` }, applyAttendanceEvent)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [academyId, month, year]);

  // An enrollment counts for the browsed month if it overlapped that month
  // at all — same rule as AttendanceTab/FeesTab's period-overlap check — so
  // a student who's since switched sport/batch still counts correctly for
  // whichever month they were actually in that old enrollment, instead of
  // that history disappearing once a newer enrollment supersedes it.
  const enrollmentOverlapsMonth = (en) => {
    const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    return (!en.join_date || en.join_date <= periodEnd) && (!en.left_date || en.left_date >= periodStart);
  };

  // Flatten each student's enrollment HISTORY (not just the currently-active
  // enrollment) into one row per sport+batch that overlapped the browsed
  // month — same pattern as AttendanceTab/FeesTab — so a student in two
  // sports/batches is tracked as two independent, filterable rows, and a
  // past sport/batch switch doesn't erase that month's history.
  const enrollmentRows = useMemo(() => {
    const rows = [];
    visibleStudents.forEach(s => {
      const history = (s.enrollmentHistory && s.enrollmentHistory.length > 0)
        ? s.enrollmentHistory
        : [{ sport: s.sport, batchLabel: s.batchLabel, join_date: s.join_date, left_date: null }];
      const seen = new Set();
      history.forEach(en => {
        if (!en.sport) return;
        if (!enrollmentOverlapsMonth(en)) return;
        const key = keyFor(s.id, en.sport, en.batchLabel);
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ student: s, sport: en.sport, batchLabel: en.batchLabel, key });
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleStudents, year, month, daysInMonth]);

  const filteredEnrollmentRows = useMemo(() => enrollmentRows.filter(r =>
    (sportFilter === 'ALL' || norm(r.sport) === norm(sportFilter)) &&
    (batchFilter === 'ALL' || norm(r.batchLabel) === norm(batchFilter))
  ), [enrollmentRows, sportFilter, batchFilter]);

  // The set of composite keys currently in view — used to scope attendance
  // rows and fee rows to exactly the enrollments matching the sport/batch
  // filters, instead of "any row belonging to this student_id".
  const enrollmentKeySet = useMemo(() =>
    new Set(filteredEnrollmentRows.map(r => r.key)),
    [filteredEnrollmentRows]);

  // Unique students behind the filtered enrollments — used for headcount
  // tiles (Total Students, Joined) which are per-person, not per-enrollment.
  const students = useMemo(() => {
    const seen = new Map();
    filteredEnrollmentRows.forEach(r => { if (!seen.has(r.student.id)) seen.set(r.student.id, r.student); });
    return Array.from(seen.values());
  }, [filteredEnrollmentRows]);

  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);

  // Chart series: attendance (present/absent per day) and strength (joined/dropped,
  // cumulative from the 1st of the selected month up to each date).
  // Attendance rows are matched against enrollmentKeySet (student+sport+batch),
  // not just student_id, so a filtered sport only counts that sport's marks.
  const monthStartStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const chartData = useMemo(() => dateRange.map(dateStr => {
    const day = parseInt(dateStr.slice(-2), 10);
    const dayRows = allAttendance.filter(a =>
      a.date === dateStr && enrollmentKeySet.has(keyFor(a.student_id, a.sport, a.batch)));
    const present = dayRows.filter(a => a.status === 'P').length;
    const absent = dayRows.filter(a => a.status === 'A').length;
    const strength = students.filter(s =>
      s.join_date && s.join_date >= monthStartStr && s.join_date <= dateStr).length;
    const dropped = students.filter(s => {
      if (!s.banned || !s.banned_on) return false;
      const bannedDate = s.banned_on.slice(0, 10);
      return bannedDate >= monthStartStr && bannedDate <= dateStr;
    }).length;
    return { day, dateStr, present, absent, strength, dropped };
  }), [dateRange, allAttendance, enrollmentKeySet, students, monthStartStr]);

  // Tiles scoped to the same month/sport/batch filters
  // Reference date for "active": today if viewing the current month, else the
  // last day of the selected month (so past months show that month's headcount).
  const refDateStr = isCurrentMonth
    ? todayIso()
    : `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const activeStudents = students.filter(s => {
    if (s.join_date && s.join_date > refDateStr) return false;
    if (s.banned && (!s.banned_on || s.banned_on.slice(0, 10) <= refDateStr)) return false;
    return true;
  });
  const currentStrength = activeStudents.length;

  const joinedStudents = activeStudents.filter(s => {
    const j = s.join_date ? new Date(s.join_date) : null;
    return j && j.getMonth() === month && j.getFullYear() === year;
  });

  // Fees scoped to the selected month, matched server-side already (see
  // fetch effect above) via an exact month equality; this local filter is
  // kept as a defensive no-op in case a fee row is ever missing a month.
  const scopedFeesAll = fees.filter(f => enrollmentKeySet.has(keyFor(f.student_id, f.sport, f.batch_label)));
  const scopedFeesMonth = scopedFeesAll.filter(feeMatchesMonth);
  const scopedFees = scopedFeesMonth.length > 0 ? scopedFeesMonth : scopedFeesAll; // fall back if month text doesn't match anything

  // Fees Collected now counts any real money actually received — both fully
  // paid AND partially paid entries — not just entries at 'paid' status.
  // Scholarships are excluded here since no real payment was collected for
  // them (see feeStatus()), even though they count as "settled" elsewhere.
  // Restricted to currently-active students only — a fee paid before a
  // student was later marked dropped shouldn't surface a dropped student
  // in this tile (Total/Joined already filter this way).
  const activeStudentIdSet = new Set(activeStudents.map(s => s.id));
  const collectedFees = scopedFees.filter(f =>
    !f.is_scholarship && (parseInt(f.amount, 10) || 0) > 0 && activeStudentIdSet.has(f.student_id));
  const collected = collectedFees.reduce((s, f) => s + (parseInt(f.amount, 10) || 0), 0);

  // Ring % for Fees Collected: collected ÷ known total due this month. Only
  // fee rows that actually exist have a due amount — an enrollment with no
  // fee row yet (never paid, never touched) has no known due amount and is
  // excluded from this denominator, so this % can understate true "amount
  // due" for months with lots of completely untouched pending fees.
  const totalDueKnown = scopedFees.reduce((s, f) => s + (parseInt(f.amount_due, 10) || 0), 0);
  const collectedPct = totalDueKnown > 0 ? Math.min(100, Math.round((collected / totalDueKnown) * 100)) : (collected > 0 ? 100 : 0);

  // --- Fee Pending: dues for the currently browsed month, for ANY eligible
  // enrollment — including banned/dropped students. A student who was active
  // and attended during the browsed month still owed that month's fee even
  // if they were banned afterward, so Fee Pending intentionally does NOT
  // filter by activeStudents (unlike Total Students / Joined / Fees
  // Collected, which are "current roster" tiles). This also keeps this
  // tile's count consistent with FeesTab.jsx, which never applies an
  // active-student filter either.
  //
  // Fee rows are only ever created once a payment is actually recorded — an
  // unpaid month has NO row in `fees` at all. So "pending" can't be read off
  // existing unpaid rows; it has to be derived the same way FeesTab.jsx
  // derives eligibility: enrolled by that month + at least one Present
  // attendance record that specific sport+batch that month, and no fully
  // paid fee row. A PARTIALLY paid entry still counts as pending — it stays
  // in this list until feeStatus() reports 'paid'. ---

  // { 'YYYY-MM': { studentId: [attendance rows] } } — scoped to the students
  // currently in view (sport/batch filters); each row still carries its own
  // sport/batch so isEligible() can match per-enrollment. Attendance is now
  // fetched for the browsed month only, so this will typically hold a
  // single month's key.
  const attendanceByStudentByMonth = useMemo(() => {
    const out = {};
    const studentIds = new Set(students.map(s => s.id));
    allAttendance.forEach(r => {
      if (!studentIds.has(r.student_id)) return;
      const mk = r.date.slice(0, 7);
      if (!out[mk]) out[mk] = {};
      if (!out[mk][r.student_id]) out[mk][r.student_id] = [];
      out[mk][r.student_id].push(r);
    });
    return out;
  }, [allAttendance, students]);

  // Keyed by student + sport + batch + month, matching FeesTab's onConflict
  // columns exactly (student_id,sport,batch_label,month) with norm()'d
  // sport/batch so casing/whitespace drift never breaks the lookup.
  const feeMap = useMemo(() => {
    const m = {};
    fees.forEach(f => { m[`${f.student_id}|${norm(f.sport)}|${norm(f.batch_label)}|${f.month}`] = f; });
    return m;
  }, [fees]);

  const pendingFeeRows = useMemo(() => {
    const rows = [];
    const attByStudent = attendanceByStudentByMonth[monthIso] || {};
    filteredEnrollmentRows.forEach(r => {
      const s = r.student;
      if (!isEligible(s, year, month + 1, attByStudent, r.sport, r.batchLabel)) return;
      const fee = feeMap[`${s.id}|${norm(r.sport)}|${norm(r.batchLabel)}|${monthIso}`] || null;
      const st = feeStatus(fee);
      if (st === 'paid') return; // fully settled (incl. scholarship) — not pending
      const due = fee?.amount_due ? parseInt(fee.amount_due, 10) : null;
      const paidSoFar = fee?.amount ? parseInt(fee.amount, 10) : 0;
      const remaining = due != null ? Math.max(due - paidSoFar, 0) : null;
      rows.push({
        id: `${s.id}|${r.sport}|${r.batchLabel}|${monthIso}`,
        name: s.name, contact: s.contact || '', school: s.school || '',
        sport: r.sport, batchLabel: r.batchLabel,
        monthKey: monthIso, monthShort: monthLabelShort, paidDate: fee?.paid_date || '',
        partial: st === 'partial', due, paidSoFar, remaining,
      });
    });
    return rows;
  }, [attendanceByStudentByMonth, filteredEnrollmentRows, feeMap, monthIso, year, month, monthLabelShort]);

  const pending = pendingFeeRows.length;

  // Ring % for Joined: share of currently-active students who joined in the
  // browsed month.
  const joinedPct = currentStrength > 0 ? Math.min(100, Math.round((joinedStudents.length / currentStrength) * 100)) : 0;

  // Ring % for Fee Pending: share of eligible enrollments this month that
  // are still pending (same eligibility rule as pendingFeeRows above, just
  // counting every eligible row instead of only the unpaid ones).
  const eligibleCount = useMemo(() => {
    const attByStudent = attendanceByStudentByMonth[monthIso] || {};
    return filteredEnrollmentRows.filter(r =>
      isEligible(r.student, year, month + 1, attByStudent, r.sport, r.batchLabel)
    ).length;
  }, [attendanceByStudentByMonth, filteredEnrollmentRows, monthIso, year, month]);
  const pendingPct = eligibleCount > 0 ? Math.min(100, Math.round((pending / eligibleCount) * 100)) : 0;

  const feeStudentList = (feeRows) => {
    const seen = new Map();
    feeRows.forEach(f => {
      const s = studentsById[f.student_id];
      if (!s) return;
      const st = feeStatus(f);
      const extraLabel = st === 'partial' ? `₹${f.amount}/₹${f.amount_due} (partial)` : `₹${f.amount}${f.month ? ' · ' + f.month : ''}`;
      const seenKey = `${s.id}|${f.sport}|${f.batch_label}|${f.month}`;
      if (!seen.has(seenKey)) {
        const totalAmount = f.amount_due ? parseInt(f.amount_due, 10) : null;
        const paidAmount = f.amount ? parseInt(f.amount, 10) : 0;
        // Override sport/batchLabel with THIS entry's own values — s.sport/
        // s.batchLabel are just the student's primary enrollment and would
        // show the wrong sport for a student who paid across two sports.
        seen.set(seenKey, {
          ...s, id: seenKey, sport: f.sport, batchLabel: f.batch_label, extra: extraLabel,
          paidDate: f.paid_date || '', paidAmount, totalAmount,
          pendingAmount: totalAmount != null ? Math.max(totalAmount - paidAmount, 0) : null,
        });
      }
    });
    return Array.from(seen.values());
  };

  // Pending rows already carry a per-row amount summary — a `partial` flag
  // plus due/paidSoFar/remaining — so StatDrilldownModal's row renderer can
  // show "₹X/₹Y left ₹Z" for partially paid entries if it chooses to.

  const monthLabel = monthLabelShort;

  const batchesForSport = visibleBatches.filter(b => sportFilter === 'ALL' || b.sport === sportFilter);

  // Per-tab access gate — after all hooks above, before any early return,
  // so Rules of Hooks holds. Staff without the Home tab granted (Staff
  // Users) land here instead of the dashboard.
  if (!canViewHome) {
    return (
      <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Home</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 70 }}>
      <div style={{
        background: '#1A336A',
        borderRadius: '0 0 28px 28px',
        margin: '-14px -14px 14px',
        padding: '14px 14px 16px',
        boxShadow: '0 6px 20px rgba(19,41,82,.35)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div className="section-title" style={{ color: '#fff' }}>Dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-sm"
            style={{
              flex: 1.3, fontSize: 12, fontWeight: 700, padding: '7px 8px', borderRadius: 8,
              background: '#132952', color: '#fff', border: '1px solid rgba(255,255,255,.15)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            onClick={() => setPopup('month')}
          >
            {monthLabelShort}
          </button>
          <button
            className="btn btn-sm"
            style={{
              flex: 1, fontSize: 12, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: '#132952', color: '#fff', border: '1px solid rgba(255,255,255,.15)',
            }}
            onClick={() => setPopup('sport')}
          >
            {sportFilter === 'ALL' ? 'All Sports' : sportFilter}
          </button>
          <button
            className="btn btn-sm"
            style={{
              flex: 1, fontSize: 12, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: '#132952', color: '#fff', border: '1px solid rgba(255,255,255,.15)',
            }}
            onClick={() => setPopup('batch')}
          >
            {batchFilter === 'ALL' ? 'All Batches' : batchFilter}
          </button>
        </div>

        {popup === 'month' && (
          <MonthYearPickerModal
            month={month}
            year={year}
            onCancel={() => setPopup(null)}
            onClear={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); setPopup(null); }}
            onSet={(m, y) => { setMonth(m); setYear(y); setPopup(null); }}
          />
        )}

        {popup === 'sport' && (
          <FilterPopup title="Select Sport" onClose={() => setPopup(null)}>
            <RadioRow name="sportsel" checked={sportFilter === 'ALL'} onChange={() => { setSportFilter('ALL'); setBatchFilter('ALL'); setPopup(null); }} label="All Sports" />
            {visibleSports.map(s => (
              <RadioRow key={s.id} name="sportsel" checked={sportFilter === s.name} onChange={() => { setSportFilter(s.name); setBatchFilter('ALL'); setPopup(null); }} label={s.name} />
            ))}
          </FilterPopup>
        )}

        {popup === 'batch' && (
          <FilterPopup title="Select Batch" onClose={() => setPopup(null)}>
            <RadioRow name="batchsel" checked={batchFilter === 'ALL'} onChange={() => { setBatchFilter('ALL'); setPopup(null); }} label="All Batches" />
            {batchesForSport.map(b => (
              <RadioRow key={b.id} name="batchsel" checked={batchFilter === b.batchLabel} onChange={() => { setBatchFilter(b.batchLabel); setPopup(null); }} label={b.batchLabel} />
            ))}
          </FilterPopup>
        )}

        <div
          style={{ textAlign: 'center', margin: '10px 0 14px', cursor: 'pointer' }}
          onClick={() => setDrilldown({ title: 'Active Students', icon: '👥', students: activeStudents })}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.75)', marginBottom: 4 }}>
            👥 Total Students
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {currentStrength}
          </div>
        </div>

        <div className="stats-grid" style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
        {[
          // Fees Collected is admin-only — staff should not see money totals.
          ...(isAdmin ? [
            { key: 'collected', iconNode: <CollectedIcon size={24} color="#36B89C" />, iconBg: 'rgba(54,184,156,0.18)', label: 'Fees Collected', value: `₹${collected.toLocaleString()}`, caption: 'Incl. partial payments',
              onClick: () => setDrilldown({ title: 'Fees Collected', icon: '✅', students: feeStudentList(collectedFees) }) },
          ] : []),
          { key: 'pending', iconNode: <PendingIcon size={24} color="#F5B82E" />, iconBg: 'rgba(245,184,46,0.18)', label: 'Fee Pending', value: pending, caption: monthLabel,
            onClick: () => setDrilldown({ title: `Fee Pending (${monthLabel})`, icon: '⚠️', rows: pendingFeeRows }) },
        ].map(tile => (
          <div
            key={tile.key}
            style={{
              cursor: 'pointer', height: 96, boxSizing: 'border-box', padding: '11px 13px',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden',
              background: '#132952', borderRadius: 14, boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}
            onClick={tile.onClick}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: tile.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {tile.iconNode}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tile.label}
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 800, color: '#fff' }}>
              {tile.value}
            </div>
            <div style={{ fontSize: 10, opacity: 0.75, color: '#fff', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tile.caption || '\u00A0'}
            </div>
          </div>
        ))}
        </div>
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '10px 10px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 800, color: 'var(--gray)', textTransform: 'uppercase',
          letterSpacing: 0.6, paddingBottom: 6, marginBottom: 6,
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ width: 3, height: 12, borderRadius: 2, background: 'var(--accent2)', display: 'inline-block' }} />
          Trends
        </div>
        <div style={{ padding: '4px 4px 2px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>
            {chartMode === 'attendance' ? 'Attendance' : 'Strength'} · <span style={{ color: 'var(--gray)', fontWeight: 600 }}>{monthLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: 2, background: 'var(--royal)', borderRadius: 8, padding: 2 }}>
            {['strength', 'attendance'].map(m => (
              <button key={m} onClick={() => setChartMode(m)}
                style={{
                  border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', textTransform: 'capitalize',
                  background: chartMode === m ? 'var(--accent2)' : 'transparent',
                  color: chartMode === m ? '#fff' : 'var(--gray)',
                  transition: 'all .15s ease',
                }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '20px 0', fontSize: 13 }}>No data yet for this month.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10.5} stroke="var(--gray)" tickLine={false} axisLine={false}
                  interval={chartData.length > 15 ? 2 : 0} />
                <YAxis fontSize={10.5} stroke="var(--gray)" allowDecimals={false} tickLine={false} axisLine={false} width={26} />
                <Tooltip content={<CustomTooltip mode={chartMode} />} cursor={false} />
                {chartMode === 'attendance' ? (
                  <>
                    <Line type="monotone" dataKey="present" stroke="#4caf8e" strokeWidth={2.5} dot={{ r: 3, fill: '#4caf8e' }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="absent" stroke="#e06b6b" strokeWidth={2.5} dot={{ r: 3, fill: '#e06b6b' }} activeDot={{ r: 5 }} />
                  </>
                ) : (
                  <>
                    <Line type="monotone" dataKey="strength" stroke="#5b7cc4" strokeWidth={2.5} dot={{ r: 3, fill: '#5b7cc4' }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="dropped" stroke="#e0a04a" strokeWidth={2.5} dot={{ r: 3, fill: '#e0a04a' }} activeDot={{ r: 5 }} />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 4, paddingBottom: 2 }}>
              {chartMode === 'attendance' ? (
                <>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gray)' }}><span style={{ color: '#4caf8e' }}>●</span> Present</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gray)' }}><span style={{ color: '#e06b6b' }}>●</span> Absent</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gray)' }}><span style={{ color: '#5b7cc4' }}>●</span> Joined: {chartData[chartData.length - 1].strength}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gray)' }}><span style={{ color: '#e0a04a' }}>●</span> Dropped: {chartData[chartData.length - 1].dropped}</span>
                </>
              )}
            </div>
          </>
        )}
        </div>
      </div>

      {drilldown && (
        <StatDrilldownModal
          title={drilldown.title}
          icon={drilldown.icon}
          students={drilldown.students || []}
          rows={drilldown.rows}
          showContact={canViewContactHome}
          canExport={canExportHome}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
