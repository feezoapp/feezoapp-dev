import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PanelWindow from '../components/PanelWindow';
import { periodStartFor, missingPeriodsFor } from '../lib/scheduleUtils';
import { PfIcon, PfLabel, PF_CSS, pfCardStyle, pfPrimaryBtn } from './perfUi';

// Local calendar date, not .toISOString() — see scheduleUtils.js for why
// UTC conversion silently shifts dates back a day in timezones ahead of UTC.
function pad2(n) { return String(n).padStart(2, '0'); }
function toLocalDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayIso() { return toLocalDateStr(new Date()); }

function periodLabelFor(frequency, periodStart) {
  const start = new Date(periodStart + 'T00:00:00');
  if (frequency === 'monthly') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (frequency === 'weekly') {
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return `Week of ${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
  }
  return start.toLocaleDateString();
}

// The period right after the one currently selected — shown so staff know
// when the next entry window opens for Weekly/Monthly programs, instead of
// guessing whether "this week" is done and it's safe to move on.
function nextPeriodStartFor(frequency, periodStart) {
  const d = new Date(periodStart + 'T00:00:00');
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + 1);
  return toLocalDateStr(d);
}

export default function AwardPointsModal({ row, academyId, userId, userName, programs, challenges, existingPoints, programFilter, onClose, onChanged }) {
  const visiblePrograms = programFilter ? programs.filter(p => p.id === programFilter) : programs;
  const visibleChallenges = programFilter ? challenges.filter(c => c.program_id === programFilter) : challenges;

  // Which day this award applies to — defaults to the earliest missing
  // period across the visible program(s), so opening this modal lands
  // straight on the actual gap instead of always starting at today (which
  // is usually already caught up and not what needs attention).
  const [date, setDate] = useState(() => {
    for (const p of visiblePrograms) {
      const missing = missingPeriodsFor(p, challenges, existingPoints);
      if (missing.length) return missing[0];
    }
    return todayIso();
  });
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);

  const programById = (id) => programs.find(p => p.id === id);

  // Recompute which value shows in each box whenever the selected date
  // changes — a different date can land in a different period, which may
  // already have its own saved score (or none yet).
  useEffect(() => {
    const map = {};
    visibleChallenges.forEach(c => {
      const prog = programById(c.program_id);
      const period = periodStartFor(prog?.frequency, date);
      const existing = existingPoints.find(p => p.challenge_id === c.id && p.period_start === period);
      map[c.id] = existing ? String(existing.points_awarded) : '';
    });
    setValues(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const setVal = (challengeId, val, maxPoints) => {
    if (val === '') { setValues(prev => ({ ...prev, [challengeId]: '' })); return; }
    let num = Number(val);
    if (Number.isNaN(num)) return;
    if (num < 0) num = 0;
    if (num > maxPoints) num = maxPoints;
    setValues(prev => ({ ...prev, [challengeId]: String(num) }));
  };

  const saveAll = async () => {
    if (date > todayIso()) { alert("You can't award points for a future date — that period hasn't opened yet."); return; }
    setBusy(true);
    try {
      const rowsToUpsert = visibleChallenges
        .filter(c => values[c.id] !== '' && values[c.id] != null)
        .map(c => {
          const prog = programById(c.program_id);
          return {
            academy_id: academyId,
            student_id: row.student.id,
            challenge_id: c.id,
            sport: c.sport,
            period_start: periodStartFor(prog?.frequency, date),
            points_awarded: Math.min(Number(values[c.id]), c.total_points),
            awarded_by_id: userId,
            awarded_by_name: userName,
            awarded_at: new Date().toISOString(),
          };
        });
      if (rowsToUpsert.length === 0) { onClose(); return; }
      const { error } = await supabase.from('student_challenge_points').upsert(rowsToUpsert, { onConflict: 'student_id,challenge_id,period_start' });
      if (error) throw error;
      onChanged?.();
      onClose();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelWindow onClose={onClose}>
      <div className="modal" style={{ width: '100%', maxWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 0, margin: 0 }}>
        <style>{PF_CSS}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(91,124,196,.12)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <PfIcon name="award" size={18} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 17, color: '#182238', lineHeight: 1.2 }}>Award Points</span>
          </div>
          <button type="button" className="pf-iconbtn" onClick={onClose} aria-label="Close award points"
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
            <PfIcon name="x" size={16} />
          </button>
        </div>

        {/* Student */}
        <div style={{ ...pfCardStyle, padding: '10px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
            {(row.student.name || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#182238', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{row.student.name}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 1, overflowWrap: 'anywhere' }}>{row.sport} · {row.batchLabel}</div>
          </div>
        </div>

        {/* Date */}
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <PfLabel htmlFor="ap-date" icon="calendar">Awarding for <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(or pick a missing date below)</span></PfLabel>
          <input id="ap-date" type="date" className="form-input pf-field" style={{ width: '100%', minWidth: 0, height: 40, fontSize: 14, padding: '0 10px', boxSizing: 'border-box', background: '#fff' }}
            value={date} max={todayIso()}
            onChange={e => setDate(e.target.value > todayIso() ? todayIso() : e.target.value)} />
        </div>

        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: 1, minHeight: 0 }}>
          {visiblePrograms.map(p => {
            const progChallenges = visibleChallenges.filter(c => c.program_id === p.id);
            if (progChallenges.length === 0) return null;
            const period = periodStartFor(p.frequency, date);
            return (
              <div key={p.id} style={{ ...pfCardStyle, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A336A', overflowWrap: 'anywhere' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#64748B', margin: '3px 0 10px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px' }}>
                  <PfIcon name="calendar" size={13} />
                  <span>{periodLabelFor(p.frequency, period)}</span>
                  {(p.frequency === 'weekly' || p.frequency === 'monthly') && (
                    <span>· Next: {periodLabelFor(p.frequency, nextPeriodStartFor(p.frequency, period))}</span>
                  )}
                </div>
                {(() => {
                  const missing = missingPeriodsFor(p, challenges, existingPoints);
                  if (missing.length === 0) return null;
                  const shown = missing.slice(0, 10);
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#B91C1C', marginBottom: 6 }}>
                        Missing ({missing.length}) — tap a date to fill it in
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {shown.map(m => {
                          const on = date === m;
                          return (
                            <button key={m} type="button" className="pf-btn" aria-pressed={on} onClick={() => setDate(m)}
                              style={{ minHeight: 32, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: on ? '#1A336A' : '#fff', color: on ? '#fff' : '#1A336A', border: `1px solid ${on ? '#1A336A' : 'var(--border)'}` }}
                            >
                              {periodLabelFor(p.frequency, m)}
                            </button>
                          );
                        })}
                        {missing.length > shown.length && (
                          <span style={{ fontSize: 12, color: 'var(--gray)', alignSelf: 'center' }}>
                            +{missing.length - shown.length} earlier
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {progChallenges.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: '#182238', overflowWrap: 'anywhere' }}>{c.name} <span style={{ color: 'var(--gray)' }}>/ {c.total_points}</span></div>
                    <input
                      type="number" min={0} max={c.total_points}
                      aria-label={`Points for ${c.name}`}
                      className="form-input pf-field" style={{ width: 76, height: 40, fontSize: 14, padding: '0 8px', textAlign: 'center', boxSizing: 'border-box', background: '#fff', flexShrink: 0 }}
                      placeholder="0"
                      value={values[c.id] ?? ''}
                      onChange={e => setVal(c.id, e.target.value, c.total_points)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
          {visibleChallenges.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--gray)', padding: '24px 20px', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#9DB2DD' }}><PfIcon name="clipboardList" size={28} /></span>
              No programs/challenges set up for {row.sport} yet.
            </div>
          )}
        </div>

        <button type="button" className="pf-btn" style={{ ...pfPrimaryBtn, width: '100%', height: 46, fontSize: 14, fontWeight: 700, marginTop: 10, flexShrink: 0 }} disabled={busy} onClick={saveAll}>
          <PfIcon name="check" size={17} /> {busy ? 'Saving…' : 'Save Points'}
        </button>
      </div>
    </PanelWindow>
  );
}
