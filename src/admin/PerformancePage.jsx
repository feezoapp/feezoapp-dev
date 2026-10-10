import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';
import AwardPointsModal from './AwardPointsModal';
import StudentChartsModal from './StudentChartsModal';
import StudentHistoryModal from './StudentHistoryModal';
import FeatureGate from './FeatureGate';
import { PfIcon, PF_CSS, pfActionBtn, pfFilterBtn, pfRadioRow, pfRadioInput, PfTruncLabel } from './perfUi';

const PRESENT_STATUS = 'P'; // adjust here if attendance uses a different code for "present"

function todayIso() { return new Date().toISOString().slice(0, 10); }
function monthStartIso() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }
function isCompleted(p) { return !!p.to_date && p.to_date < todayIso(); }

// How many award periods a program has had so far — points now accumulate
// one entry per period (see AwardPointsModal's periodStartFor, which this
// must stay in sync with), so the "possible points so far" denominator has
// to grow with elapsed periods too, or a Daily program would sail past
// 100% after just a few days of stacking entries.
function countPeriods(program, todayIsoStr) {
  if (!program?.from_date) return 1;
  const start = new Date(program.from_date + 'T00:00:00');
  const capEndIso = program.to_date && program.to_date < todayIsoStr ? program.to_date : todayIsoStr;
  const end = new Date(capEndIso + 'T00:00:00');
  if (end < start) return 0;

  if (program.frequency === 'monthly') {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  }
  if (program.frequency === 'weekly') {
    const startSun = new Date(start); startSun.setDate(start.getDate() - start.getDay());
    const endSun = new Date(end); endSun.setDate(end.getDate() - end.getDay());
    return Math.round((endSun - startSun) / (7 * 24 * 60 * 60 * 1000)) + 1;
  }
  if (program.frequency === 'custom' && Array.isArray(program.custom_days) && program.custom_days.length) {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      if (program.custom_days.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count || 1;
  }
  // daily (default)
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}


function PerformancePageContent() {
  const { academyId, isAdmin, user, appUser } = useAuth();
  const { visibleStudents, visibleSports } = useAcademyData();
  const navigate = useNavigate();

  const [attendance, setAttendance] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  const [dateFrom, setDateFrom] = useState(monthStartIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [selectedSport, setSelectedSport] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(''); // '' = all batches for the sport
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [sortDir, setSortDir] = useState('desc'); // 'desc' = high to low
  const [filtersOpen, setFiltersOpen] = useState(false); // collapse bar
  const [popup, setPopup] = useState(null); // 'sport' | 'program' | 'sort' | null

  const [awardFor, setAwardFor] = useState(null); // row currently awarding points for
  const [chartsFor, setChartsFor] = useState(null); // row currently viewing charts for
  const [historyFor, setHistoryFor] = useState(null); // row currently viewing history for

  // default: first visible sport, once loaded
  useEffect(() => {
    if (visibleSports.length && !selectedSport) {
      setSelectedSport(visibleSports[0].name);
    }
  }, [visibleSports]); // eslint-disable-line

  // active (non-completed) programs for the currently selected sport
  const programsForSport = useMemo(
    () => programs.filter(p => p.sport === selectedSport && !isCompleted(p)),
    [programs, selectedSport]
  );

  // distinct batches enrolled in the selected sport, sourced from student
  // enrollments (same source as batchLabel) so it stays in sync without an
  // extra query. Uses the plain batchLabel (e.g. "Junior") as the filter
  // value, NOT en.batch — en.batch is a "Sport::BatchName" composite key
  // (see AcademyDataContext), while the attendance table stores the plain
  // label, so matching on the composite key would never find a row.
  const batchesForSport = useMemo(() => {
    const seen = new Set();
    visibleStudents.forEach(s => {
      (s.enrollments || []).forEach(en => {
        if (en.sport !== selectedSport) return;
        seen.add(en.batchLabel);
      });
    });
    return Array.from(seen, batchLabel => ({ batch: batchLabel, batchLabel }));
  }, [visibleStudents, selectedSport]);

  // reset the batch filter whenever the sport changes (or the previously
  // selected batch no longer exists for this sport)
  useEffect(() => {
    if (selectedBatch && !batchesForSport.some(b => b.batch === selectedBatch)) {
      setSelectedBatch('');
    }
  }, [batchesForSport]); // eslint-disable-line

  // default: first active program for the selected sport — resets whenever
  // the sport changes or the current selection no longer exists/is completed
  useEffect(() => {
    if (programsForSport.length === 0) { setSelectedProgramId(''); return; }
    if (!programsForSport.some(p => p.id === selectedProgramId)) {
      setSelectedProgramId(programsForSport[0].id);
    }
  }, [programsForSport]); // eslint-disable-line

  const selectedProgram = useMemo(
    () => programs.find(p => p.id === selectedProgramId) || null,
    [programs, selectedProgramId]
  );

  const load = async () => {
    if (!academyId) return;
    setLoading(true);
    const [att, prog, chal, pts] = await Promise.all([
      supabase.from('attendance').select('student_id, sport, batch, status, date').eq('academy_id', academyId).gte('date', dateFrom).lte('date', dateTo),
      supabase.from('programs').select('*').eq('academy_id', academyId),
      supabase.from('program_challenges').select('*').eq('academy_id', academyId),
      supabase.from('student_challenge_points').select('*').eq('academy_id', academyId),
    ]);
    setAttendance(att.data || []);
    setPrograms(prog.data || []);
    setChallenges(chal.data || []);
    setPoints(pts.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [academyId, dateFrom, dateTo]); // eslint-disable-line

  const attendanceWeight = selectedProgram?.attendance_weight ?? 50;
  const courseWeight = 100 - attendanceWeight;

  // attendance % per student+sport — denominator is every distinct session
  // date recorded for that sport (across all students) in the date range, not
  // just this student's own rows. So a day another student was marked but
  // this student has no row for at all correctly counts against them as
  // absent, instead of being silently excluded and inflating their %.
  //
  // When a specific batch is selected, everything is scoped to that batch's
  // own attendance rows first — so both the session-day denominator and each
  // student's present days only come from that batch, not the whole sport.
  const attendanceScoped = useMemo(
    () => selectedBatch ? attendance.filter(a => a.batch === selectedBatch) : attendance,
    [attendance, selectedBatch]
  );

  const attendancePct = useMemo(() => {
    const sessionDatesBySport = {};
    attendanceScoped.forEach(a => {
      sessionDatesBySport[a.sport] = sessionDatesBySport[a.sport] || new Set();
      sessionDatesBySport[a.sport].add(a.date);
    });

    // distinct present DATES per student+sport — using a Set (not a raw row
    // count) so a duplicate row on the same date (e.g. the student is in more
    // than one batch and got marked once per batch) doesn't double-count and
    // push the percentage over 100%.
    const presentDates = {};
    const studentSportKeys = new Set();
    attendanceScoped.forEach(a => {
      const key = `${a.student_id}|${a.sport}`;
      studentSportKeys.add(key);
      if ((a.status || '').toUpperCase() === PRESENT_STATUS) {
        presentDates[key] = presentDates[key] || new Set();
        presentDates[key].add(a.date);
      }
    });

    const out = {};
    studentSportKeys.forEach(key => {
      const sport = key.split('|')[1];
      const totalDays = sessionDatesBySport[sport]?.size || 0;
      const present = presentDates[key]?.size || 0;
      out[key] = totalDays ? Math.min(100, (present / totalDays) * 100) : 0;
    });
    return out;
  }, [attendanceScoped]);

  // total possible points for the SELECTED PROGRAM so far — the per-period
  // max (sum of its challenges) times how many periods have elapsed, since
  // points now accumulate one entry per period instead of just once ever.
  const totalPointsForProgram = useMemo(() => {
    if (!selectedProgramId || !selectedProgram) return 0;
    const perPeriodMax = challenges.filter(c => c.program_id === selectedProgramId).reduce((sum, c) => sum + (c.total_points || 0), 0);
    const periods = countPeriods(selectedProgram, todayIso());
    return perPeriodMax * periods;
  }, [challenges, selectedProgramId, selectedProgram]);

  // points earned per student — scoped to the selected program's challenges only
  const earnedPointsByStudent = useMemo(() => {
    if (!selectedProgramId) return {};
    const challengeIds = new Set(challenges.filter(c => c.program_id === selectedProgramId).map(c => c.id));
    const out = {};
    points.forEach(p => {
      if (!challengeIds.has(p.challenge_id)) return;
      out[p.student_id] = (out[p.student_id] || 0) + Number(p.points_awarded || 0);
    });
    return out;
  }, [points, challenges, selectedProgramId]);

  // build one row per student enrolled in the SELECTED sport — batches within
  // that sport are merged into a single entry, unless a specific batch is
  // selected, in which case only that batch's enrollments are included
  const rows = useMemo(() => {
    const bySportStudent = new Map();
    visibleStudents.forEach(s => {
      (s.enrollments || []).forEach(en => {
        if (en.sport !== selectedSport) return;
        if (selectedBatch && en.batchLabel !== selectedBatch) return;
        const key = `${s.id}|${en.sport}`;
        if (!bySportStudent.has(key)) {
          bySportStudent.set(key, { student: s, sport: en.sport, batchLabels: [], batchKeys: [] });
        }
        const entry = bySportStudent.get(key);
        if (!entry.batchKeys.includes(en.batch)) {
          entry.batchKeys.push(en.batch);
          entry.batchLabels.push(en.batchLabel);
        }
      });
    });
    const out = [];
    bySportStudent.forEach((entry, key) => {
      const attPct = attendancePct[key] ?? 0;
      const earnedPts = earnedPointsByStudent[entry.student.id] || 0;
      const coursePct = totalPointsForProgram ? Math.min(100, (earnedPts / totalPointsForProgram) * 100) : 0;
      const finalScore = attPct * (attendanceWeight / 100) + coursePct * (courseWeight / 100);
      out.push({
        key,
        student: entry.student,
        sport: entry.sport,
        batchLabel: entry.batchLabels.join(', '),
        batchKey: entry.batchKeys.join(','),
        attendancePct: attPct,
        coursePct,
        finalScore,
      });
    });
    return out;
  }, [visibleStudents, selectedSport, selectedBatch, attendancePct, totalPointsForProgram, earnedPointsByStudent, attendanceWeight, courseWeight]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => (r.student.name || '').toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => sortDir === 'desc' ? b.finalScore - a.finalScore : a.finalScore - b.finalScore);
    return list;
  }, [rows, search, sortDir]);
  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <style>{PF_CSS}</style>
      {chartsFor ? (
        <StudentChartsModal
          row={chartsFor}
          academyId={academyId}
          userId={user?.id}
          userName={appUser?.name || user?.email}
          canEdit={true}
          totalPoints={totalPointsForProgram}
          earnedPoints={earnedPointsByStudent[chartsFor.student.id] || 0}
          pointsRecords={points.filter(p => p.student_id === chartsFor.student.id)}
          challenges={challenges.filter(c => c.program_id === selectedProgramId)}
          programs={selectedProgram ? [selectedProgram] : []}
          attendanceRecords={attendanceScoped.filter(a => a.student_id === chartsFor.student.id && a.sport === chartsFor.sport)}
          sportAttendanceRecords={attendanceScoped.filter(a => a.sport === chartsFor.sport)}
          onClose={() => setChartsFor(null)}
        />
      ) : historyFor ? (
        <StudentHistoryModal
          row={historyFor}
          programs={programs.filter(p => p.sport === historyFor.sport)}
          pointsRecords={points.filter(p => p.student_id === historyFor.student.id)}
          challenges={challenges.filter(c => c.sport === historyFor.sport)}
          onClose={() => setHistoryFor(null)}
          onAddPoints={(programId) => setAwardFor({ ...historyFor, programFilter: programId })}
        />
      ) : (
      <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
          <PfIcon name="trophy" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>Performance Leaderboard</span>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="pf-btn" style={{ ...pfActionBtn, background: '#fff', color: '#1A336A', border: '1px solid var(--border)' }} onClick={() => navigate('/admin/performance/programs')}>
              <PfIcon name="list" size={15} /> List
            </button>
            <button type="button" className="pf-btn" style={{ ...pfActionBtn, background: '#1A336A', color: '#fff', border: 'none' }} onClick={() => navigate('/admin/performance/add')}>
              <PfIcon name="plus" size={15} stroke={2.4} /> Add
            </button>
          </div>
        )}
      </div>

      {/* search with clear button — same markup/classes as the Students tab */}
      <div className="search-wrap" style={{ marginBottom: 8 }}>
        <PfIcon name="search" size={15} />
        <input
          type="text"
          className="search-input"
          aria-label="Search student"
          placeholder="Search student…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="search-clear-btn pf-iconbtn" onClick={() => setSearch('')} aria-label="Clear search"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PfIcon name="x" size={14} />
          </button>
        )}
      </div>

      {/* filters card */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '4px 10px', marginBottom: 8, boxShadow: '0 1px 2px rgba(16,32,64,.05)', flexShrink: 0 }}>
        <button
          type="button"
          className="pf-head"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(o => !o)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', minHeight: 36, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', fontWeight: 600, fontSize: 14 }}>
            <PfIcon name="funnel" size={16} /> Filters &amp; Sort
          </span>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--card2)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PfIcon name={filtersOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </span>
        </button>

        {filtersOpen && (
          <div style={{ padding: '8px 0 8px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            {/* date range for attendance calculation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 6 }}>
              <PfIcon name="calendarCheck" size={14} /> Date range
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
              <input type="date" className="form-input" aria-label="From date" style={{ flex: 1, minWidth: 0, height: 40, fontSize: 13, padding: '0 8px', boxSizing: 'border-box', background: '#fff' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>–</span>
              <input type="date" className="form-input" aria-label="To date" style={{ flex: 1, minWidth: 0, height: 40, fontSize: 13, padding: '0 8px', boxSizing: 'border-box', background: '#fff' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>

            {/* program / sport / batch / sort — wraps to two rows on narrow screens */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="pf-btn" style={pfFilterBtn} onClick={() => setPopup('program')}>
                <PfTruncLabel>{selectedProgram?.name || 'Program'}</PfTruncLabel>
                <PfIcon name="chevronDown" size={14} />
              </button>
              <button type="button" className="pf-btn" style={pfFilterBtn} onClick={() => setPopup('sport')}>
                <PfTruncLabel>{selectedSport || 'Sport'}</PfTruncLabel>
                <PfIcon name="chevronDown" size={14} />
              </button>
              <button type="button" className="pf-btn" style={pfFilterBtn} onClick={() => setPopup('batch')}>
                <PfTruncLabel>{batchesForSport.find(b => b.batch === selectedBatch)?.batchLabel || 'All Batches'}</PfTruncLabel>
                <PfIcon name="chevronDown" size={14} />
              </button>
              <button type="button" className="pf-btn" style={pfFilterBtn} onClick={() => setPopup('sort')}>
                <PfTruncLabel>Sort</PfTruncLabel>
                <PfIcon name="chevronDown" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* popups */}
      {popup && (
        <div
          className="pf-overlay"
          onClick={() => setPopup(null)}
          role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="pf-popup" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '14px 12px 10px', width: '100%', maxWidth: 320, maxHeight: 'min(68vh, 480px)', overflowY: 'auto', boxShadow: '0 12px 32px rgba(10,18,35,.24)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: 6, padding: '0 4px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A336A', textAlign: 'center' }}>
                {popup === 'sport' ? 'Select Sport' : popup === 'program' ? 'Select Program' : popup === 'batch' ? 'Select Batch' : 'Sort By'}
              </div>
              <button type="button" className="pf-iconbtn" onClick={() => setPopup(null)} aria-label="Close"
                style={{ position: 'absolute', right: 0, width: 28, height: 28, borderRadius: '50%', background: '#F1F3F8', border: 'none', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <PfIcon name="x" size={15} />
              </button>
            </div>

            {popup === 'sport' && visibleSports.map(s => (
              <label key={s.name} style={{ ...pfRadioRow, background: selectedSport === s.name ? 'rgba(91,124,196,.12)' : 'transparent', color: selectedSport === s.name ? '#1A336A' : '#333', fontWeight: selectedSport === s.name ? 600 : 500 }}>
                <input style={pfRadioInput} type="radio" name="sportsel" checked={selectedSport === s.name} onChange={() => { setSelectedSport(s.name); setPopup(null); }} />
                {s.name}
              </label>
            ))}

            {popup === 'batch' && (
              <label style={{ ...pfRadioRow, background: !selectedBatch ? 'rgba(91,124,196,.12)' : 'transparent', color: !selectedBatch ? '#1A336A' : '#333', fontWeight: !selectedBatch ? 600 : 500 }}>
                <input style={pfRadioInput} type="radio" name="batchsel" checked={!selectedBatch} onChange={() => { setSelectedBatch(''); setPopup(null); }} />
                All Batches
              </label>
            )}
            {popup === 'batch' && batchesForSport.map(b => (
              <label key={b.batch} style={{ ...pfRadioRow, background: selectedBatch === b.batch ? 'rgba(91,124,196,.12)' : 'transparent', color: selectedBatch === b.batch ? '#1A336A' : '#333', fontWeight: selectedBatch === b.batch ? 600 : 500 }}>
                <input style={pfRadioInput} type="radio" name="batchsel" checked={selectedBatch === b.batch} onChange={() => { setSelectedBatch(b.batch); setPopup(null); }} />
                {b.batchLabel}
              </label>
            ))}
            {popup === 'batch' && batchesForSport.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--gray)', padding: '8px 10px' }}>No batches found for {selectedSport}.</div>
            )}

            {popup === 'program' && programsForSport.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--gray)', padding: '8px 10px' }}>No active programs for {selectedSport}.</div>
            )}
            {popup === 'program' && programsForSport.map(p => (
              <label key={p.id} style={{ ...pfRadioRow, background: selectedProgramId === p.id ? 'rgba(91,124,196,.12)' : 'transparent', color: selectedProgramId === p.id ? '#1A336A' : '#333', fontWeight: selectedProgramId === p.id ? 600 : 500 }}>
                <input style={pfRadioInput} type="radio" name="programsel" checked={selectedProgramId === p.id} onChange={() => { setSelectedProgramId(p.id); setPopup(null); }} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</span>
              </label>
            ))}

            {popup === 'sort' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[{ v: 'desc', l: 'High to Low' }, { v: 'asc', l: 'Low to High' }].map(o => (
                  <label key={o.v} style={{ ...pfRadioRow, background: sortDir === o.v ? 'rgba(91,124,196,.12)' : 'transparent', color: sortDir === o.v ? '#1A336A' : '#333', fontWeight: sortDir === o.v ? 600 : 500 }}>
                    <input style={pfRadioInput} type="radio" name="sortdir" checked={sortDir === o.v} onChange={() => { setSortDir(o.v); setPopup(null); }} />
                    {o.l}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20, fontSize: 13 }}>Loading…</div>}

      {!loading && !selectedProgram && (
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '28px 20px', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#9DB2DD' }}><PfIcon name="clipboardList" size={28} /></span>
          <div>No program created{selectedSport ? ` for ${selectedSport}` : ''}.</div>
          {isAdmin && (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="pf-btn" style={{ ...pfActionBtn, background: '#1A336A', color: '#fff', border: 'none' }} onClick={() => navigate('/admin/performance/add')}>
                <PfIcon name="plus" size={15} stroke={2.4} /> Add Program
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && selectedProgram && filteredRows.map((r, i) => (
        <div key={r.key} className="pf-card" role="button" tabIndex={0}
          onClick={() => setHistoryFor(r)}
          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setHistoryFor(r); } }}
          style={{ padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(16,32,64,.05)', boxSizing: 'border-box', maxWidth: '100%' }}>
          <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#182238', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{r.student.name}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, overflowWrap: 'anywhere' }}>{r.sport} · {r.batchLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 12px', fontSize: 11.5, color: '#475569', marginTop: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Attendance" aria-label={`Attendance ${r.attendancePct.toFixed(0)}%`}>
                <PfIcon name="calendarCheck" size={13} /> {r.attendancePct.toFixed(0)}%
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Points" aria-label={`Points ${r.coursePct.toFixed(0)}%`}>
                <PfIcon name="award" size={13} /> {r.coursePct.toFixed(0)}%
              </span>
            </div>
          </div>
          {/* chart icon column — fixed width so it lines up in a straight column
              across every row, right next to the total-points column */}
          <div style={{ width: 34, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <span
              className="pf-chart"
              onClick={(e) => { e.stopPropagation(); setChartsFor(r); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setChartsFor(r); } }}
              title="View charts"
              aria-label={`View charts for ${r.student.name}`}
              role="button"
              tabIndex={0}
              style={{
                display: 'inline-block', width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', position: 'relative', flexShrink: 0,
                background: 'conic-gradient(#f4695f 0deg 60deg, #f8c559 60deg 120deg, #1a9e4c 120deg 180deg, #5b9bd9 180deg 240deg, #1976d2 240deg 300deg, #b04a4a 300deg 360deg)',
              }}
            >
              <span style={{ position: 'absolute', inset: 5, borderRadius: '50%', background: 'var(--card)' }} />
            </span>
          </div>
          <div style={{ width: 44, textAlign: 'right', fontWeight: 800, color: '#1A336A', fontSize: 16, flexShrink: 0 }} aria-label={`Score ${r.finalScore.toFixed(0)}`}>{r.finalScore.toFixed(0)}</div>
        </div>
      ))}
      {!loading && selectedProgram && filteredRows.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '28px 20px', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#9DB2DD' }}><PfIcon name="search" size={28} /></span>
          No students match the current filters.
        </div>
      )}

      </>
      )}

      {awardFor && (
        <AwardPointsModal
          row={awardFor}
          academyId={academyId}
          userId={user?.id}
          userName={appUser?.name || user?.email}
          programs={programs.filter(p => p.sport === awardFor.sport)}
          challenges={challenges.filter(c => c.sport === awardFor.sport)}
          existingPoints={points.filter(p => p.student_id === awardFor.student.id)}
          programFilter={awardFor.programFilter}
          onClose={() => setAwardFor(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

export default function PerformancePage() {
  return (
    <FeatureGate feature="has_performance">
      <PerformancePageContent />
    </FeatureGate>
  );
}
