import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import StatDrilldownModal from '../components/StatDrilldownModal';

// ---------------------------------------------------------------------------
// Presentation-only tokens. Nothing below this block changes any data,
// state, or computation in the component — only how it's painted.
// ---------------------------------------------------------------------------
const PALETTE = {
  blue: { solid: '#4f6df5', from: '#5b7cf7', to: '#3a4fd9', glow: 'rgba(79,109,245,0.35)' },
  orange: { solid: '#ff8a3d', from: '#ffa35c', to: '#f5701f', glow: 'rgba(255,138,61,0.35)' },
  green: { solid: '#17b892', from: '#22c9a4', to: '#0e9b7c', glow: 'rgba(23,184,146,0.35)' },
  red: { solid: '#f4515f', from: '#ff6b76', to: '#e02f42', glow: 'rgba(244,81,95,0.35)' },
};

function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload || !payload.length) return null;
  const key1 = mode === 'attendance' ? 'present' : 'strength';
  const key2 = mode === 'attendance' ? 'absent' : 'dropped';
  const label1 = mode === 'attendance' ? 'Present' : 'Active';
  const label2 = mode === 'attendance' ? 'Absent' : 'Dropped';
  const p1 = payload.find(p => p.dataKey === key1);
  const p2 = payload.find(p => p.dataKey === key2);
  if (!p1 && !p2) return null;
  return (
    <div style={{ background: 'var(--card)', borderRadius: 10, padding: '9px 13px', fontSize: 12, boxShadow: '0 8px 24px rgba(20,20,40,0.25)', border: '1px solid rgba(120,120,160,0.12)' }}>
      <div style={{ fontWeight: 800, marginBottom: 4, letterSpacing: 0.2 }}>Day {label}</div>
      {p1 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: p1.color, display: 'inline-block', boxShadow: `0 0 0 3px ${p1.color}22` }} /> {label1}: <b>{p1.value}</b></div>}
      {p2 && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: p2.color, display: 'inline-block', boxShadow: `0 0 0 3px ${p2.color}22` }} /> {label2}: <b>{p2.value}</b></div>}
    </div>
  );
}

// Same centered popup used by StudentsTab's / AttendanceTab's Sport/Batch/Sort
// filters — a dark overlay + a card of radio rows, closing itself on selection.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,14,30,.55)', backdropFilter: 'blur(3px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 16, padding: 16, width: '85%', maxWidth: 320, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(10,10,30,.35)', border: '1px solid rgba(120,120,160,0.12)', borderTop: `3px solid ${PALETTE.blue.solid}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'rgba(120,120,160,0.12)', border: 'none', borderRadius: '50%', width: 26, height: 26, fontSize: 16, color: 'var(--gray)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, padding: '8px 6px', cursor: 'pointer', borderRadius: 8, background: checked ? `${PALETTE.blue.solid}14` : 'transparent', fontWeight: checked ? 700 : 500, transition: 'background .12s ease' }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} style={{ accentColor: PALETTE.blue.solid, width: 15, height: 15 }} />
      {label}
    </label>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const toIsoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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

const norm = (v) => (v || '').toString().trim().toLowerCase();
const keyFor = (studentId, sport, batchLabel) => `${studentId}::${norm(sport)}::${norm(batchLabel)}`;

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

function isEligible(student, year, month, attendanceByStudent, sport, batchLabel) {
  if (student.join_date) {
    const checkEnd = toIsoDate(new Date(year, month, 0));
    if (student.join_date > checkEnd) return false;
  }
  const rows = attendanceByStudent[student.id];
  return !!(rows && rows.some(r =>
    r.status === 'P' &&
    (!sport || norm(r.sport) === norm(sport)) &&
    (!batchLabel || norm(r.batch) === norm(batchLabel))
  ));
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
  const [popup, setPopup] = useState(null);
  const [fees, setFees] = useState([]);
  const [allAttendance, setAllAttendance] = useState([]);
  const [chartMode, setChartMode] = useState('attendance');
  const [drilldown, setDrilldown] = useState(null);

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const isFutureMonth = new Date(year, month, 1) > today;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const endDay = isFutureMonth ? 0 : isCurrentMonth ? today.getDate() : daysInMonth;
  const dateRange = Array.from({ length: endDay }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  const monthLabelShort = new Date(year, month, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });
  const monthIso = `${year}-${String(month + 1).padStart(2, '0')}`;
  const feeMatchesMonth = (f) => f.month === monthIso;

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

  useEffect(() => {
    if (!academyId) return;

    const monthStartIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const rangeEndIso = isFutureMonth
      ? monthStartIso
      : `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const targetMonthIso = `${year}-${String(month + 1).padStart(2, '0')}`;

    const attKey = (r) => `${r.student_id}|${r.date}|${norm(r.sport)}|${norm(r.batch)}`;

    const applyFeeEvent = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || row.month !== targetMonthIso) return;
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
      if (!row || row.date < monthStartIso || row.date > rangeEndIso) return;
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

  const enrollmentOverlapsMonth = (en) => {
    const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    return (!en.join_date || en.join_date <= periodEnd) && (!en.left_date || en.left_date >= periodStart);
  };

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

  const enrollmentKeySet = useMemo(() =>
    new Set(filteredEnrollmentRows.map(r => r.key)),
    [filteredEnrollmentRows]);

  const students = useMemo(() => {
    const seen = new Map();
    filteredEnrollmentRows.forEach(r => { if (!seen.has(r.student.id)) seen.set(r.student.id, r.student); });
    return Array.from(seen.values());
  }, [filteredEnrollmentRows]);

  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);

  const chartData = useMemo(() => dateRange.map(dateStr => {
    const day = parseInt(dateStr.slice(-2), 10);
    const dayRows = allAttendance.filter(a =>
      a.date === dateStr && enrollmentKeySet.has(keyFor(a.student_id, a.sport, a.batch)));
    const present = dayRows.filter(a => a.status === 'P').length;
    const absent = dayRows.filter(a => a.status === 'A').length;
    const strength = students.filter(s => {
      if (s.join_date && s.join_date > dateStr) return false;
      if (s.banned && (!s.banned_on || s.banned_on.slice(0, 10) <= dateStr)) return false;
      return true;
    }).length;
    const dropped = students.filter(s => {
      return s.banned && s.banned_on && s.banned_on.slice(0, 10) <= dateStr;
    }).length;
    return { day, dateStr, present, absent, strength, dropped };
  }), [dateRange, allAttendance, enrollmentKeySet, students]);

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

  const scopedFeesAll = fees.filter(f => enrollmentKeySet.has(keyFor(f.student_id, f.sport, f.batch_label)));
  const scopedFeesMonth = scopedFeesAll.filter(feeMatchesMonth);
  const scopedFees = scopedFeesMonth.length > 0 ? scopedFeesMonth : scopedFeesAll;

  const activeStudentIdSet = new Set(activeStudents.map(s => s.id));
  const collectedFees = scopedFees.filter(f =>
    !f.is_scholarship && (parseInt(f.amount, 10) || 0) > 0 && activeStudentIdSet.has(f.student_id));
  const collected = collectedFees.reduce((s, f) => s + (parseInt(f.amount, 10) || 0), 0);

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
      if (st === 'paid') return;
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
        seen.set(seenKey, {
          ...s, id: seenKey, sport: f.sport, batchLabel: f.batch_label, extra: extraLabel,
          paidDate: f.paid_date || '', paidAmount, totalAmount,
          pendingAmount: totalAmount != null ? Math.max(totalAmount - paidAmount, 0) : null,
        });
      }
    });
    return Array.from(seen.values());
  };

  const monthLabel = monthLabelShort;
  const nav = (unit, dir) => {
    if (unit === 'month') {
      let m = month + dir, y = year;
      if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
      setMonth(m); setYear(y);
    } else {
      setYear(y => y + dir);
    }
  };

  const batchesForSport = visibleBatches.filter(b => sportFilter === 'ALL' || b.sport === sportFilter);

  if (!canViewHome) {
    return (
      <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Home</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  const navBtnStyle = (extra = {}) => ({
    border: 'none',
    background: 'rgba(79,109,245,0.10)',
    color: PALETTE.blue.solid,
    fontWeight: 700,
    borderRadius: 9,
    cursor: 'pointer',
    transition: 'background .12s ease, transform .1s ease',
    ...extra,
  });

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="section-title" style={{ position: 'relative', display: 'inline-block' }}>
            Dashboard
            <span style={{ position: 'absolute', left: 0, bottom: -5, width: 30, height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${PALETTE.blue.solid}, ${PALETTE.green.solid})` }} />
          </div>
        </div>
        <div className="my-nav" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="my-nav-btn yr" style={navBtnStyle({ padding: '7px 9px', fontSize: 12 })} onClick={() => nav('year', -1)} title="Previous Year">«</button>
          <button className="my-nav-btn" style={navBtnStyle({ padding: '7px 11px', fontSize: 13 })} onClick={() => nav('month', -1)} title="Previous Month">‹</button>
          <div className="my-nav-label" style={{ flex: 1, textAlign: 'center', fontWeight: 800, fontSize: 14, letterSpacing: 0.2 }}>{monthLabel}</div>
          <button className="my-nav-btn" style={navBtnStyle({ padding: '7px 11px', fontSize: 13 })} onClick={() => nav('month', 1)} title="Next Month">›</button>
          <button className="my-nav-btn yr" style={navBtnStyle({ padding: '7px 9px', fontSize: 12 })} onClick={() => nav('year', 1)} title="Next Year">»</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            className="btn btn-outline btn-sm"
            style={{
              flex: 1, fontSize: 12.5, fontWeight: 700, padding: '9px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              borderRadius: 10, border: `1.5px solid ${sportFilter === 'ALL' ? 'rgba(120,120,160,0.2)' : PALETTE.blue.solid}`,
              background: sportFilter === 'ALL' ? 'transparent' : `${PALETTE.blue.solid}12`,
              color: sportFilter === 'ALL' ? 'var(--gray)' : PALETTE.blue.solid,
              cursor: 'pointer', transition: 'all .12s ease',
            }}
            onClick={() => setPopup('sport')}
          >
            🏅 {sportFilter === 'ALL' ? 'All Sports' : sportFilter}
          </button>
          <button
            className="btn btn-outline btn-sm"
            style={{
              flex: 1, fontSize: 12.5, fontWeight: 700, padding: '9px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              borderRadius: 10, border: `1.5px solid ${batchFilter === 'ALL' ? 'rgba(120,120,160,0.2)' : PALETTE.orange.solid}`,
              background: batchFilter === 'ALL' ? 'transparent' : `${PALETTE.orange.solid}12`,
              color: batchFilter === 'ALL' ? 'var(--gray)' : PALETTE.orange.solid,
              cursor: 'pointer', transition: 'all .12s ease',
            }}
            onClick={() => setPopup('batch')}
          >
            🧩 {batchFilter === 'ALL' ? 'All Batches' : batchFilter}
          </button>
        </div>
      </div>

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

      <div className="stats-grid" style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[
          { key: 'total', pal: PALETTE.blue, icon: '👥', label: 'Total Students', value: currentStrength, caption: '',
            onClick: () => setDrilldown({ title: 'Active Students', icon: '👥', students: activeStudents }) },
          { key: 'joined', pal: PALETTE.orange, icon: '🆕', label: 'Joined', value: joinedStudents.length, caption: '',
            onClick: () => setDrilldown({ title: 'Joined This Month', icon: '🆕', students: joinedStudents }) },
          ...(isAdmin ? [
            { key: 'collected', pal: PALETTE.green, icon: '✅', label: 'Fees Collected', value: `₹${collected.toLocaleString()}`, caption: 'Incl. partial payments',
              onClick: () => setDrilldown({ title: 'Fees Collected', icon: '✅', students: feeStudentList(collectedFees) }) },
          ] : []),
          { key: 'pending', pal: PALETTE.red, icon: '⚠️', label: 'Fee Pending', value: pending, caption: monthLabel,
            onClick: () => setDrilldown({ title: `Fee Pending (${monthLabel})`, icon: '⚠️', rows: pendingFeeRows }) },
        ].map(tile => (
          <div
            key={tile.key}
            className={`stat-card grad stat-${tile.key === 'total' ? 'blue' : tile.key === 'joined' ? 'orange' : tile.key === 'collected' ? 'green' : 'red'}`}
            style={{
              cursor: 'pointer', height: 92, boxSizing: 'border-box', padding: '11px 13px',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden',
              borderRadius: 16, color: '#fff', position: 'relative',
              background: `linear-gradient(135deg, ${tile.pal.from}, ${tile.pal.to})`,
              boxShadow: `0 10px 22px -6px ${tile.pal.glow}`,
              transition: 'transform .15s ease, box-shadow .15s ease',
            }}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            onClick={tile.onClick}
          >
            <div style={{ position: 'absolute', right: -18, top: -18, width: 74, height: 74, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, position: 'relative' }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>{tile.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.95 }}>
                {tile.label}
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, position: 'relative' }}>
              {tile.value}
            </div>
            <div style={{ fontSize: 9.5, opacity: 0.85, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', position: 'relative' }}>
              {tile.caption || '\u00A0'}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14, padding: '14px 14px 10px', borderRadius: 16, boxShadow: '0 6px 20px -8px rgba(20,20,50,0.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>
            {chartMode === 'attendance' ? 'Attendance' : 'Strength'} <span style={{ color: 'var(--gray)', fontWeight: 600 }}>· {monthLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: 3, background: 'rgba(120,120,160,0.12)', borderRadius: 10, padding: 3 }}>
            {['attendance', 'strength'].map(m => (
              <button key={m} onClick={() => setChartMode(m)}
                style={{
                  border: 'none', borderRadius: 8, padding: '6px 13px', fontSize: 11.5, fontWeight: 700,
                  cursor: 'pointer', textTransform: 'capitalize',
                  background: chartMode === m ? `linear-gradient(135deg, ${PALETTE.blue.from}, ${PALETTE.blue.to})` : 'transparent',
                  color: chartMode === m ? '#fff' : 'var(--gray)',
                  boxShadow: chartMode === m ? `0 4px 10px -3px ${PALETTE.blue.glow}` : 'none',
                  transition: 'all .15s ease',
                }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '30px 0', fontSize: 13 }}>No data yet for this month.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10.5} stroke="var(--gray)" tickLine={false} axisLine={false}
                  interval={chartData.length > 15 ? 2 : 0} />
                <YAxis fontSize={10.5} stroke="var(--gray)" allowDecimals={false} tickLine={false} axisLine={false} width={26} />
                <Tooltip content={<CustomTooltip mode={chartMode} />} cursor={{ stroke: 'rgba(120,120,160,0.25)', strokeWidth: 1 }} />
                {chartMode === 'attendance' ? (
                  <>
                    <Line type="monotone" dataKey="present" stroke={PALETTE.green.solid} strokeWidth={3} dot={{ r: 3.5, fill: PALETTE.green.solid, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="absent" stroke={PALETTE.red.solid} strokeWidth={3} dot={{ r: 3.5, fill: PALETTE.red.solid, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </>
                ) : (
                  <>
                    <Line type="monotone" dataKey="strength" stroke={PALETTE.blue.solid} strokeWidth={3} dot={{ r: 3.5, fill: PALETTE.blue.solid, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="dropped" stroke={PALETTE.orange.solid} strokeWidth={3} dot={{ r: 3.5, fill: PALETTE.orange.solid, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 8, paddingBottom: 4 }}>
              {chartMode === 'attendance' ? (
                <>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: PALETTE.green.solid, display: 'inline-block' }} /> Present</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: PALETTE.red.solid, display: 'inline-block' }} /> Absent</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: PALETTE.blue.solid, display: 'inline-block' }} /> Active</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: PALETTE.orange.solid, display: 'inline-block' }} /> Dropped</span>
                </>
              )}
            </div>
          </>
        )}
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
