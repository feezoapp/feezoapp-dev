import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import StatDrilldownModal from '../components/StatDrilldownModal';

// Modern dashboard presentation layer. Data/eligibility logic is intentionally
// kept compatible with the existing Home tab contract; this component focuses
// on hierarchy, spacing, responsive cards and a cleaner analytics surface.
function CustomTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  const key1 = mode === 'attendance' ? 'present' : 'strength';
  const key2 = mode === 'attendance' ? 'absent' : 'dropped';
  const label1 = mode === 'attendance' ? 'Present' : 'Active';
  const label2 = mode === 'attendance' ? 'Absent' : 'Dropped';
  const p1 = payload.find(p => p.dataKey === key1);
  const p2 = payload.find(p => p.dataKey === key2);
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', fontSize: 12, boxShadow: '0 10px 30px rgba(0,0,0,.18)' }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Day {label}</div>
      {p1 && <div style={{ marginBottom: 3 }}><span style={{ color: p1.color }}>●</span> {label1}: <b>{p1.value}</b></div>}
      {p2 && <div><span style={{ color: p2.color }}>●</span> {label2}: <b>{p2.value}</b></div>}
    </div>
  );
}

function FilterPopup({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.48)', backdropFilter: 'blur(3px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: 16, width: '100%', maxWidth: 340, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'var(--bg)', border: '1px solid var(--border)', width: 30, height: 30, borderRadius: 9, fontSize: 18, color: 'var(--gray)', cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, padding: '9px 4px', cursor: 'pointer' }}><input type="radio" name={name} checked={checked} onChange={onChange} />{label}</label>;
}

const pad2 = n => String(n).padStart(2, '0');
const toIsoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayIso = () => toIsoDate(new Date());
const norm = v => (v || '').toString().trim().toLowerCase();
const keyFor = (studentId, sport, batchLabel) => `${studentId}::${norm(sport)}::${norm(batchLabel)}`;
const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function feeStatus(fee) {
  if (!fee) return 'unpaid';
  if (fee.is_scholarship) return 'paid';
  const due = parseInt(fee.amount_due, 10);
  const paid = parseInt(fee.amount, 10) || 0;
  if (!due || Number.isNaN(due)) return fee.status === 'paid' && paid > 0 ? 'paid' : 'unpaid';
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
  return !!(rows && rows.some(r => r.status === 'P' && (!sport || norm(r.sport) === norm(sport)) && (!batchLabel || norm(r.batch) === norm(batchLabel))));
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
  const dateRange = Array.from({ length: endDay }, (_, i) => `${year}-${pad2(month + 1)}-${pad2(i + 1)}`);
  const monthLabel = new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const monthLabelShort = new Date(year, month, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });
  const monthIso = `${year}-${pad2(month + 1)}`;

  useEffect(() => {
    (async () => {
      if (!academyId) { setFees([]); setAllAttendance([]); setDataLoaded(true); return; }
      try {
        const monthStartIso = `${year}-${pad2(month + 1)}-01`;
        const rangeEndIso = isFutureMonth ? monthStartIso : `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;
        const [feesRes, attendanceData] = await Promise.all([
          supabase.from('fees').select('*').eq('academy_id', academyId).eq('month', monthIso),
          fetchAllRows(() => supabase.from('attendance').select('date,status,student_id,sport,batch').eq('academy_id', academyId).gte('date', monthStartIso).lte('date', rangeEndIso)),
        ]);
        setFees(feesRes.data || []);
        setAllAttendance(attendanceData || []);
      } catch (err) { console.error('HomeTab: failed to load dashboard data', err); }
      finally { setDataLoaded(true); }
    })();
  }, [academyId, month, year]);

  useEffect(() => {
    if (!academyId) return;
    const monthStartIso = `${year}-${pad2(month + 1)}-01`;
    const rangeEndIso = isFutureMonth ? monthStartIso : `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;
    const targetMonthIso = `${year}-${pad2(month + 1)}`;
    const attKey = r => `${r.student_id}|${r.date}|${norm(r.sport)}|${norm(r.batch)}`;
    const applyFeeEvent = payload => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || row.month !== targetMonthIso) return;
      setFees(prev => { if (payload.eventType === 'DELETE') return prev.filter(f => f.id !== row.id); const i = prev.findIndex(f => f.id === row.id); if (i < 0) return [...prev, row]; const n = prev.slice(); n[i] = row; return n; });
    };
    const applyAttendanceEvent = payload => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || row.date < monthStartIso || row.date > rangeEndIso) return;
      const thin = { date: row.date, status: row.status, student_id: row.student_id, sport: row.sport, batch: row.batch };
      const k = attKey(thin);
      setAllAttendance(prev => { const i = prev.findIndex(r => attKey(r) === k); if (payload.eventType === 'DELETE') { if (i < 0) return prev; const n = prev.slice(); n.splice(i, 1); return n; } if (i < 0) return [...prev, thin]; const n = prev.slice(); n[i] = thin; return n; });
    };
    const channel = supabase.channel(`home-tab-${academyId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'fees', filter: `academy_id=eq.${academyId}` }, applyFeeEvent).on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `academy_id=eq.${academyId}` }, applyAttendanceEvent).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [academyId, month, year]);

  const enrollmentOverlapsMonth = en => {
    const start = `${year}-${pad2(month + 1)}-01`, end = `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;
    return (!en.join_date || en.join_date <= end) && (!en.left_date || en.left_date >= start);
  };

  const enrollmentRows = useMemo(() => {
    const rows = [];
    visibleStudents.forEach(s => {
      const history = s.enrollmentHistory?.length ? s.enrollmentHistory : [{ sport: s.sport, batchLabel: s.batchLabel, join_date: s.join_date, left_date: null }];
      const seen = new Set();
      history.forEach(en => { if (!en.sport || !enrollmentOverlapsMonth(en)) return; const key = keyFor(s.id, en.sport, en.batchLabel); if (seen.has(key)) return; seen.add(key); rows.push({ student: s, sport: en.sport, batchLabel: en.batchLabel, key }); });
    });
    return rows;
  }, [visibleStudents, year, month, daysInMonth]);

  const filteredEnrollmentRows = useMemo(() => enrollmentRows.filter(r => (sportFilter === 'ALL' || norm(r.sport) === norm(sportFilter)) && (batchFilter === 'ALL' || norm(r.batchLabel) === norm(batchFilter))), [enrollmentRows, sportFilter, batchFilter]);
  const enrollmentKeySet = useMemo(() => new Set(filteredEnrollmentRows.map(r => r.key)), [filteredEnrollmentRows]);
  const students = useMemo(() => { const seen = new Map(); filteredEnrollmentRows.forEach(r => { if (!seen.has(r.student.id)) seen.set(r.student.id, r.student); }); return [...seen.values()]; }, [filteredEnrollmentRows]);
  const studentsById = useMemo(() => Object.fromEntries(students.map(s => [s.id, s])), [students]);

  const chartData = useMemo(() => dateRange.map((dateStr, i) => {
    const dayRows = allAttendance.filter(a => a.date === dateStr && enrollmentKeySet.has(keyFor(a.student_id, a.sport, a.batch)));
    const present = dayRows.filter(a => a.status === 'P').length;
    const absent = dayRows.filter(a => a.status === 'A').length;
    const strength = students.filter(s => !(s.join_date && s.join_date > dateStr) && !(s.banned && (!s.banned_on || s.banned_on.slice(0, 10) <= dateStr))).length;
    const dropped = students.filter(s => s.banned && s.banned_on && s.banned_on.slice(0, 10) <= dateStr).length;
    return { day: i + 1, dateStr, present, absent, strength, dropped };
  }), [dateRange, allAttendance, enrollmentKeySet, students]);

  const refDateStr = isCurrentMonth ? todayIso() : `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;
  const activeStudents = students.filter(s => !(s.join_date && s.join_date > refDateStr) && !(s.banned && (!s.banned_on || s.banned_on.slice(0, 10) <= refDateStr)));
  const currentStrength = activeStudents.length;
  const joinedStudents = activeStudents.filter(s => { const j = s.join_date ? new Date(s.join_date) : null; return j && j.getMonth() === month && j.getFullYear() === year; });
  const scopedFeesAll = fees.filter(f => enrollmentKeySet.has(keyFor(f.student_id, f.sport, f.batch_label)));
  const scopedFeesMonth = scopedFeesAll.filter(f => f.month === monthIso);
  const scopedFees = scopedFeesMonth.length ? scopedFeesMonth : scopedFeesAll;
  const activeStudentIdSet = new Set(activeStudents.map(s => s.id));
  const collectedFees = scopedFees.filter(f => !f.is_scholarship && (parseInt(f.amount, 10) || 0) > 0 && activeStudentIdSet.has(f.student_id));
  const collected = collectedFees.reduce((sum, f) => sum + (parseInt(f.amount, 10) || 0), 0);

  const attendanceByStudentByMonth = useMemo(() => {
    const out = {}, ids = new Set(students.map(s => s.id));
    allAttendance.forEach(r => { if (!ids.has(r.student_id)) return; const mk = r.date.slice(0, 7); out[mk] ||= {}; out[mk][r.student_id] ||= []; out[mk][r.student_id].push(r); });
    return out;
  }, [allAttendance, students]);
  const feeMap = useMemo(() => { const m = {}; fees.forEach(f => { m[`${f.student_id}|${norm(f.sport)}|${norm(f.batch_label)}|${f.month}`] = f; }); return m; }, [fees]);
  const pendingFeeRows = useMemo(() => {
    const rows = [], attByStudent = attendanceByStudentByMonth[monthIso] || {};
    filteredEnrollmentRows.forEach(r => {
      const s = r.student;
      if (!isEligible(s, year, month + 1, attByStudent, r.sport, r.batchLabel)) return;
      const fee = feeMap[`${s.id}|${norm(r.sport)}|${norm(r.batchLabel)}|${monthIso}`] || null;
      const st = feeStatus(fee);
      if (st === 'paid') return;
      const due = fee?.amount_due ? parseInt(fee.amount_due, 10) : null, paidSoFar = fee?.amount ? parseInt(fee.amount, 10) : 0;
      rows.push({ id: `${s.id}|${r.sport}|${r.batchLabel}|${monthIso}`, name: s.name, contact: s.contact || '', school: s.school || '', sport: r.sport, batchLabel: r.batchLabel, monthKey: monthIso, monthShort: monthLabelShort, paidDate: fee?.paid_date || '', partial: st === 'partial', due, paidSoFar, remaining: due != null ? Math.max(due - paidSoFar, 0) : null });
    });
    return rows;
  }, [attendanceByStudentByMonth, filteredEnrollmentRows, feeMap, monthIso, year, month, monthLabelShort]);
  const pending = pendingFeeRows.length;

  const feeStudentList = feeRows => {
    const seen = new Map();
    feeRows.forEach(f => { const s = studentsById[f.student_id]; if (!s) return; const st = feeStatus(f); const k = `${s.id}|${f.sport}|${f.batch_label}|${f.month}`; if (!seen.has(k)) { const totalAmount = f.amount_due ? parseInt(f.amount_due, 10) : null; const paidAmount = f.amount ? parseInt(f.amount, 10) : 0; seen.set(k, { ...s, id: k, sport: f.sport, batchLabel: f.batch_label, extra: st === 'partial' ? `₹${f.amount}/₹${f.amount_due} (partial)` : `₹${f.amount}${f.month ? ' · ' + f.month : ''}`, paidDate: f.paid_date || '', paidAmount, totalAmount, pendingAmount: totalAmount != null ? Math.max(totalAmount - paidAmount, 0) : null }); } });
    return [...seen.values()];
  };

  const nav = (unit, dir) => { if (unit === 'month') { let m = month + dir, y = year; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setMonth(m); setYear(y); } else setYear(y => y + dir); };
  const batchesForSport = visibleBatches.filter(b => sportFilter === 'ALL' || b.sport === sportFilter);
  if (canViewHome === false) return null;

  const cards = [
    { key: 'total', cls: 'stat-blue', icon: '👥', label: 'Total Students', value: currentStrength, helper: 'Active roster', onClick: () => setDrilldown({ title: 'Active Students', icon: '👥', students: activeStudents }) },
    { key: 'joined', cls: 'stat-orange', icon: '✦', label: 'Joined', value: joinedStudents.length, helper: 'This month', onClick: () => setDrilldown({ title: 'Joined This Month', icon: '✦', students: joinedStudents }) },
    ...(isAdmin ? [{ key: 'collected', cls: 'stat-green', icon: '₹', label: 'Fees Collected', value: `₹${collected.toLocaleString()}`, helper: 'Payments received', onClick: () => setDrilldown({ title: 'Fees Collected', icon: '₹', students: feeStudentList(collectedFees) }) }] : []),
    { key: 'pending', cls: 'stat-red', icon: '!', label: 'Fee Pending', value: pending, helper: monthLabelShort, onClick: () => setDrilldown({ title: `Fee Pending (${monthLabelShort})`, icon: '!', rows: pendingFeeRows }) },
  ];

  return (
    <div style={{ width: '100%', paddingBottom: 24 }}>
      <style>{`
        .feezo-home { --dash-radius: 18px; }
        .feezo-home .dash-header { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:18px; }
        .feezo-home .dash-eyebrow { color:var(--gray); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin-bottom:4px; }
        .feezo-home .dash-title { margin:0; font-size:25px; line-height:1.15; font-weight:850; letter-spacing:-.03em; }
        .feezo-home .dash-subtitle { margin:5px 0 0; color:var(--gray); font-size:12px; }
        .feezo-home .dash-actions { display:flex; gap:7px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
        .feezo-home .modern-control { min-height:38px; padding:0 12px; border:1px solid var(--border); border-radius:11px; background:var(--card); color:inherit; font-size:11.5px; font-weight:750; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.04); }
        .feezo-home .month-control { display:flex; align-items:center; gap:2px; padding:3px; border:1px solid var(--border); border-radius:12px; background:var(--card); }
        .feezo-home .month-control button { width:30px; height:30px; border:0; border-radius:9px; background:transparent; color:inherit; cursor:pointer; font-weight:800; }
        .feezo-home .month-control button:hover { background:var(--bg); }
        .feezo-home .month-name { min-width:108px; text-align:center; font-size:11.5px; font-weight:800; }
        .feezo-home .kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:11px; }
        .feezo-home .kpi { position:relative; min-height:112px; overflow:hidden; border:1px solid var(--border); border-radius:var(--dash-radius); padding:14px; background:var(--card); box-shadow:0 6px 20px rgba(15,23,42,.055); cursor:pointer; transition:transform .18s ease,box-shadow .18s ease; }
        .feezo-home .kpi:hover { transform:translateY(-2px); box-shadow:0 10px 28px rgba(15,23,42,.10); }
        .feezo-home .kpi:after { content:''; position:absolute; width:82px; height:82px; border-radius:50%; right:-32px; bottom:-35px; background:currentColor; opacity:.06; }
        .feezo-home .kpi-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .feezo-home .kpi-icon { width:32px; height:32px; border-radius:10px; display:grid; place-items:center; font-size:14px; font-weight:900; background:currentColor; color:var(--card); }
        .feezo-home .kpi-label { font-size:11px; font-weight:750; color:var(--gray); }
        .feezo-home .kpi-value { margin-top:12px; font-size:24px; line-height:1; font-weight:900; letter-spacing:-.035em; }
        .feezo-home .kpi-helper { margin-top:7px; font-size:10px; color:var(--gray); }
        .feezo-home .blue { color:#4f73d9; } .feezo-home .orange { color:#d9933f; } .feezo-home .green { color:#3eaa82; } .feezo-home .red { color:#d65f6b; }
        .feezo-home .analytics { display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:11px; margin-top:14px; }
        .feezo-home .panel { border:1px solid var(--border); border-radius:var(--dash-radius); background:var(--card); box-shadow:0 6px 20px rgba(15,23,42,.045); }
        .feezo-home .chart-panel { padding:16px 16px 10px; min-width:0; }
        .feezo-home .panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
        .feezo-home .panel-title { font-size:14px; font-weight:850; } .feezo-home .panel-meta { color:var(--gray); font-weight:600; font-size:11px; margin-left:4px; }
        .feezo-home .segmented { display:flex; gap:2px; padding:3px; border:1px solid var(--border); border-radius:10px; background:var(--bg); }
        .feezo-home .segmented button { border:0; border-radius:7px; padding:6px 10px; background:transparent; color:var(--gray); font-size:10.5px; font-weight:800; cursor:pointer; text-transform:capitalize; }
        .feezo-home .segmented button.active { background:var(--card); color:inherit; box-shadow:0 2px 7px rgba(0,0,0,.08); }
        .feezo-home .insight-panel { padding:16px; }
        .feezo-home .insight-title { font-size:14px; font-weight:850; margin-bottom:13px; }
        .feezo-home .insight-row { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border); }
        .feezo-home .insight-row:last-child { border-bottom:0; }
        .feezo-home .insight-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; background:currentColor; }
        .feezo-home .insight-copy { min-width:0; flex:1; } .feezo-home .insight-label { font-size:10.5px; color:var(--gray); } .feezo-home .insight-value { font-size:16px; font-weight:850; margin-top:2px; }
        .feezo-home .filters { display:flex; gap:7px; margin-top:11px; }
        @media (max-width:900px) { .feezo-home .kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .feezo-home .analytics { grid-template-columns:1fr; } .feezo-home .insight-panel { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; } .feezo-home .insight-title { grid-column:1/-1; margin-bottom:0; } .feezo-home .insight-row { border:1px solid var(--border); border-radius:12px; padding:10px; } }
        @media (max-width:600px) { .feezo-home .dash-header { align-items:flex-start; flex-direction:column; } .feezo-home .dash-actions { width:100%; justify-content:flex-start; } .feezo-home .month-control { flex:1; } .feezo-home .month-name { flex:1; } .feezo-home .modern-control { flex:1; min-width:0; } .feezo-home .kpi { min-height:102px; padding:12px; } .feezo-home .kpi-value { font-size:21px; } .feezo-home .insight-panel { grid-template-columns:1fr; } .feezo-home .insight-title { grid-column:auto; } .feezo-home .insight-row { border:0; border-bottom:1px solid var(--border); border-radius:0; } .feezo-home .chart-panel { padding:13px 10px 8px; } .feezo-home .panel-head { align-items:flex-start; } }
      `}</style>

      <div className="feezo-home">
        <div className="dash-header">
          <div><div className="dash-eyebrow">Overview</div><h1 className="dash-title">Dashboard</h1><p className="dash-subtitle">A quick view of your academy performance.</p></div>
          <div className="dash-actions">
            <div className="month-control"><button onClick={() => nav('year', -1)} title="Previous year">«</button><button onClick={() => nav('month', -1)} title="Previous month">‹</button><div className="month-name">{monthLabel}</div><button onClick={() => nav('month', 1)} title="Next month">›</button><button onClick={() => nav('year', 1)} title="Next year">»</button></div>
            <button className="modern-control" onClick={() => setPopup('sport')}>{sportFilter === 'ALL' ? 'All Sports' : sportFilter}</button>
            <button className="modern-control" onClick={() => setPopup('batch')}>{batchFilter === 'ALL' ? 'All Batches' : batchFilter}</button>
          </div>
        </div>

        <div className="kpi-grid">
          {cards.map(card => <div key={card.key} className={`kpi ${card.cls.replace('stat-', '')}`} onClick={card.onClick}><div className="kpi-top"><span className="kpi-label">{card.label}</span><span className="kpi-icon">{card.icon}</span></div><div className="kpi-value">{card.value}</div><div className="kpi-helper">{card.helper}</div></div>)}
        </div>

        <div className="analytics">
          <div className="panel chart-panel">
            <div className="panel-head"><div className="panel-title">{chartMode === 'attendance' ? 'Attendance Overview' : 'Student Strength'}<span className="panel-meta">· {monthLabelShort}</span></div><div className="segmented">{['attendance','strength'].map(m => <button key={m} className={chartMode === m ? 'active' : ''} onClick={() => setChartMode(m)}>{m}</button>)}</div></div>
            {chartData.length === 0 ? <div style={{ textAlign:'center', color:'var(--gray)', padding:'55px 0', fontSize:12 }}>No data yet for this month.</div> : <><ResponsiveContainer width="100%" height={235}><LineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 5" /><XAxis dataKey="day" fontSize={10} stroke="var(--gray)" tickLine={false} axisLine={false} interval={chartData.length > 15 ? 2 : 0} /><YAxis fontSize={10} stroke="var(--gray)" allowDecimals={false} tickLine={false} axisLine={false} width={28} /><Tooltip content={<CustomTooltip mode={chartMode} />} cursor={false} />{chartMode === 'attendance' ? <><Line type="monotone" dataKey="present" stroke="#4caf8e" strokeWidth={3} dot={false} activeDot={{ r:5 }} /><Line type="monotone" dataKey="absent" stroke="#e06b6b" strokeWidth={3} dot={false} activeDot={{ r:5 }} /></> : <><Line type="monotone" dataKey="strength" stroke="#5b7cc4" strokeWidth={3} dot={false} activeDot={{ r:5 }} /><Line type="monotone" dataKey="dropped" stroke="#e0a04a" strokeWidth={3} dot={false} activeDot={{ r:5 }} /></>}</LineChart></ResponsiveContainer><div style={{ display:'flex', justifyContent:'center', gap:20, padding:'3px 0 5px' }}>{(chartMode === 'attendance' ? [['#4caf8e','Present'],['#e06b6b','Absent']] : [['#5b7cc4','Active'],['#e0a04a','Dropped']]).map(([c,l]) => <span key={l} style={{fontSize:11,fontWeight:650,color:'var(--gray)'}}><span style={{color:c}}>●</span> {l}</span>)}</div></>}
          </div>

          <div className="panel insight-panel">
            <div className="insight-title">Quick insights</div>
            <div className="insight-row blue"><span className="insight-dot"/><div className="insight-copy"><div className="insight-label">Active students</div><div className="insight-value">{currentStrength}</div></div></div>
            <div className="insight-row orange"><span className="insight-dot"/><div className="insight-copy"><div className="insight-label">New this month</div><div className="insight-value">{joinedStudents.length}</div></div></div>
            <div className="insight-row red"><span className="insight-dot"/><div className="insight-copy"><div className="insight-label">Fee pending</div><div className="insight-value">{pending}</div></div></div>
          </div>
        </div>
      </div>

      {popup === 'sport' && <FilterPopup title="Select Sport" onClose={() => setPopup(null)}><RadioRow name="sportsel" checked={sportFilter === 'ALL'} onChange={() => { setSportFilter('ALL'); setBatchFilter('ALL'); setPopup(null); }} label="All Sports" />{visibleSports.map(s => <RadioRow key={s.id} name="sportsel" checked={sportFilter === s.name} onChange={() => { setSportFilter(s.name); setBatchFilter('ALL'); setPopup(null); }} label={s.name} />)}</FilterPopup>}
      {popup === 'batch' && <FilterPopup title="Select Batch" onClose={() => setPopup(null)}><RadioRow name="batchsel" checked={batchFilter === 'ALL'} onChange={() => { setBatchFilter('ALL'); setPopup(null); }} label="All Batches" />{batchesForSport.map(b => <RadioRow key={b.id} name="batchsel" checked={batchFilter === b.batchLabel} onChange={() => { setBatchFilter(b.batchLabel); setPopup(null); }} label={b.batchLabel} />)}</FilterPopup>}

      {drilldown && <StatDrilldownModal title={drilldown.title} icon={drilldown.icon} students={drilldown.students || []} rows={drilldown.rows} showContact={canViewContactHome} canExport={canExportHome} onClose={() => setDrilldown(null)} />}
    </div>
  );
}
