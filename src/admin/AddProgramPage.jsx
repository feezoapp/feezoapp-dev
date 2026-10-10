import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';
import { PfIcon, PfLabel, PfSection, PfPageHeader, PF_CSS, pfCtl, pfOutlineBtn, pfPrimaryBtn } from './perfUi';

const FREQUENCIES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom' },
];

const WEEKDAYS = [
  { v: 0, l: 'Sun' }, { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function AddProgramPage() {
  const { academyId, isAdmin, user, appUser } = useAuth();
  const { visibleSports, visibleBatches } = useAcademyData();
  const navigate = useNavigate();

  const [sport, setSport] = useState(visibleSports[0]?.name || '');
  const [batch, setBatch] = useState(''); // '' = applies to all batches of the sport
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('weekly');
  const [customDays, setCustomDays] = useState([]);
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState('');

  const [attendanceWeight, setAttendanceWeight] = useState(50);
  const [attendanceInput, setAttendanceInput] = useState('50');
  const [programInput, setProgramInput] = useState('50');

  const [challengeList, setChallengeList] = useState([]); // [{ name, points }]
  const [chName, setChName] = useState('');
  const [chPoints, setChPoints] = useState('');

  const [busy, setBusy] = useState(false);

  const batchOptions = visibleBatches.filter(b => b.sport === sport);

  // Selecting a different sport invalidates whatever batch was chosen for
  // the old one — reset back to "All batches" rather than silently keeping
  // a batch label that doesn't belong to the newly selected sport.
  useEffect(() => { setBatch(''); }, [sport]);

  // staff should never reach this route — nav/route guards keep it hidden,
  // this is just a safety net matching ProgramManagerModal's old check
  if (!isAdmin) return null;

  const toggleDay = (v) => {
    setCustomDays(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const commitAttendance = () => {
    if (attendanceInput === '') { setAttendanceInput(String(attendanceWeight)); return; }
    const clamped = Math.max(0, Math.min(100, Number(attendanceInput)));
    setAttendanceWeight(clamped);
    setAttendanceInput(String(clamped));
    setProgramInput(String(100 - clamped));
  };
  const commitProgram = () => {
    if (programInput === '') { setProgramInput(String(100 - attendanceWeight)); return; }
    const clamped = Math.max(0, Math.min(100, Number(programInput)));
    setAttendanceWeight(100 - clamped);
    setAttendanceInput(String(100 - clamped));
    setProgramInput(String(clamped));
  };

  const addChallengeRow = () => {
    if (!chName.trim() || !chPoints) return;
    setChallengeList(list => [...list, { name: chName.trim(), points: Number(chPoints) }]);
    setChName(''); setChPoints('');
  };
  const removeChallengeRow = (i) => setChallengeList(list => list.filter((_, idx) => idx !== i));

  const save = async () => {
    const missing = [];
    if (!name.trim()) missing.push('Program name');
    if (!sport) missing.push('Sport');
    if (!fromDate) missing.push('Start date');
    if (!toDate) missing.push('End date');
    if (fromDate && toDate && toDate < fromDate) missing.push('End date must be after the start date');
    if (frequency === 'custom' && customDays.length === 0) missing.push('At least one entry day (Custom schedule)');
    if (challengeList.length === 0) missing.push('At least one challenge');
    if (missing.length > 0) {
      alert('Please fix the following before saving:\n\n' + missing.map(m => '• ' + m).join('\n'));
      return;
    }

    setBusy(true);
    // Wrapped so any unexpected failure (network blip, an exception that
    // isn't a plain Supabase {error} response) always surfaces as an alert
    // and always clears `busy` — without this, a thrown error here silently
    // aborts the function: no error shown, no navigation, and the button
    // could get stuck or reset with nothing visibly happening.
    try {
      const { data: prog, error } = await supabase.from('programs').insert({
        academy_id: academyId,
        sport,
        batch: batch || null,
        name: name.trim(),
        frequency,
        custom_days: frequency === 'custom' ? customDays : null,
        from_date: fromDate || null,
        to_date: toDate || null,
        attendance_weight: attendanceWeight,
        created_by_id: user?.id,
        created_by_name: appUser?.name || user?.email,
      }).select().single();

      if (error) { alert('Failed to save program: ' + error.message); return; }

      const rows = challengeList.map(c => ({
        program_id: prog.id, academy_id: academyId, sport,
        name: c.name, total_points: c.points, created_by_id: user?.id,
      }));
      const { error: chErr } = await supabase.from('program_challenges').insert(rows);
      if (chErr) {
        alert('Program saved, but challenges failed to save: ' + chErr.message);
        navigate('/admin/performance/programs');
        return;
      }
      navigate('/admin/performance/programs');
    } catch (e) {
      alert('Failed to save program: ' + (e?.message || 'Something went wrong — check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 };

  return (
    <div className="page active" style={{ paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <style>{PF_CSS}</style>
      <PfPageHeader icon="plus" title="Add Program">
        <button type="button" className="pf-btn" style={pfOutlineBtn} onClick={() => navigate('/admin/performance')}>
          <PfIcon name="x" size={15} /> Cancel
        </button>
      </PfPageHeader>

      {/* sport + batch + name */}
      <PfSection icon="clipboardList" title="Program details">
        <div style={{ ...grid2, marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-sport" icon="trophy">Sport</PfLabel>
            <select id="ap-sport" className="form-select pf-field" style={pfCtl} value={sport} onChange={e => setSport(e.target.value)}>
              {visibleSports.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-batch" icon="layers">Batch</PfLabel>
            <select id="ap-batch" className="form-select pf-field" style={pfCtl} value={batch} onChange={e => setBatch(e.target.value)}>
              <option value="">All batches</option>
              {batchOptions.map(b => <option key={b.id} value={b.batchLabel}>{b.batchLabel}</option>)}
            </select>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <PfLabel htmlFor="ap-name" icon="target">Program name</PfLabel>
          <input id="ap-name" className="form-input pf-field" style={pfCtl} placeholder="Program name (e.g. Level 1 Basics)"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
      </PfSection>

      <PfSection icon="calendar" title="Program dates">
        <div style={{ marginBottom: 10 }}>
          <PfLabel htmlFor="ap-freq" icon="clock">Entry frequency</PfLabel>
          <select id="ap-freq" className="form-select pf-field" style={pfCtl} value={frequency} onChange={e => setFrequency(e.target.value)}>
            {FREQUENCIES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        {frequency === 'custom' && (
          <div style={{ marginBottom: 12 }}>
            <PfLabel icon="calendarCheck">Entry days</PfLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WEEKDAYS.map(d => {
                const on = customDays.includes(d.v);
                return (
                  <button key={d.v} type="button" className="pf-btn" aria-pressed={on}
                    onClick={() => toggleDay(d.v)}
                    style={{ height: 36, minWidth: 44, padding: '0 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: on ? '#1A336A' : '#fff', color: on ? '#fff' : '#1A336A', border: `1px solid ${on ? '#1A336A' : 'var(--border)'}` }}
                  >{d.l}</button>
                );
              })}
            </div>
          </div>
        )}

        <div style={grid2}>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-from">Start date</PfLabel>
            <input id="ap-from" type="date" className="form-input pf-field" style={pfCtl} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-to">End date</PfLabel>
            <input id="ap-to" type="date" className="form-input pf-field" style={pfCtl} value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>
      </PfSection>

      <PfSection icon="award" title="Score split (%)">
        <div style={grid2}>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-att">Attendance</PfLabel>
            <input id="ap-att" type="number" min={0} max={100} className="form-input pf-field" style={pfCtl}
              value={attendanceInput} onChange={e => setAttendanceInput(e.target.value)} onBlur={commitAttendance} />
          </div>
          <div style={{ minWidth: 0 }}>
            <PfLabel htmlFor="ap-prog">Program</PfLabel>
            <input id="ap-prog" type="number" min={0} max={100} className="form-input pf-field" style={pfCtl}
              value={programInput} onChange={e => setProgramInput(e.target.value)} onBlur={commitProgram} />
          </div>
        </div>
      </PfSection>

      <PfSection icon="clipboardList" title="Challenges">
        {challengeList.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 6px 6px 10px', marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: '#182238', minWidth: 0, overflowWrap: 'anywhere' }}>{c.name} <span style={{ color: '#64748B' }}>· {c.points} pts</span></div>
            <button type="button" className="pf-iconbtn" onClick={() => removeChallengeRow(i)} aria-label={`Remove ${c.name}`} title="Remove"
              style={{ width: 32, height: 32, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
              <PfIcon name="x" size={14} />
            </button>
          </div>
        ))}
        {challengeList.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 8 }}>No challenges added yet.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input className="form-input pf-field" aria-label="Challenge name" style={{ ...pfCtl, flex: 2 }} placeholder="Challenge name" value={chName} onChange={e => setChName(e.target.value)} />
          <input type="number" className="form-input pf-field" aria-label="Challenge points" style={{ ...pfCtl, flex: 1 }} placeholder="Points" value={chPoints} onChange={e => setChPoints(e.target.value)} />
          <button type="button" className="pf-btn" aria-label="Add challenge" title="Add challenge" onClick={addChallengeRow}
            style={{ width: 40, height: 40, borderRadius: 10, background: '#1A336A', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
            <PfIcon name="plus" size={18} stroke={2.4} />
          </button>
        </div>
      </PfSection>

      <button type="button" className="pf-btn" style={{ ...pfPrimaryBtn, width: '100%', height: 46, fontSize: 14, fontWeight: 700, marginTop: 4 }}
        disabled={busy}
        onClick={save}>
        <PfIcon name="save" size={17} /> {busy ? 'Saving…' : 'Save Program'}
      </button>
    </div>
  );
}
