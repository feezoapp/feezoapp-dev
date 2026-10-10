import { useMemo, useState } from 'react';
import { isDue, getDueDate, missingPeriodsFor } from '../lib/scheduleUtils';
import { PfIcon, PfBadge, PfEmpty, PfStudentHeader, PF_CSS, pfCardStyle } from './perfUi';

export default function StudentHistoryModal({
  row, programs, challenges, pointsRecords, onClose, onAddPoints,
}) {
  const [expandedProgram, setExpandedProgram] = useState(null); // program id whose history list is open

  const challengeById = useMemo(() => {
    const m = {};
    challenges.forEach(c => { m[c.id] = c; });
    return m;
  }, [challenges]);

  // points, mapped with challenge + program info, newest first
  const pointsList = useMemo(() => {
    return pointsRecords
      .filter(p => challengeById[p.challenge_id])
      .map(p => ({
        id: p.id,
        challengeId: p.challenge_id,
        programId: challengeById[p.challenge_id]?.program_id,
        challengeName: challengeById[p.challenge_id]?.name || 'Challenge',
        points: Number(p.points_awarded || 0),
        date: p.awarded_at || p.created_at,
        by: p.awarded_by_name || 'Unknown',
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [pointsRecords, challengeById]);

  // per-program: challenge count, last entry, due state, and any missing
  // (skipped) periods — canAdd covers both "the latest period is due" and
  // "an earlier period was never filled in", since isDue() alone only ever
  // looks at the most recent entry and would otherwise hide older gaps.
  const programCards = useMemo(() => {
    return programs.map(p => {
      const progChallengeIds = new Set(challenges.filter(c => c.program_id === p.id).map(c => c.id));
      const progPoints = pointsList.filter(pt => progChallengeIds.has(pt.challengeId));
      const lastEntry = progPoints[0] || null;
      const due = isDue(p, lastEntry?.date);
      const dueDate = getDueDate(p, lastEntry?.date);
      const missing = missingPeriodsFor(p, challenges, pointsRecords);
      return {
        program: p,
        challengeCount: progChallengeIds.size,
        lastEntry,
        history: progPoints,
        due,
        dueDate,
        missing,
        canAdd: due || missing.length > 0,
      };
    }).filter(pc => pc.challengeCount > 0);
  }, [programs, challenges, pointsList, pointsRecords]);

  return (
    // Rendered in-flow as page content, same pattern as the charts page.
    <div style={{ maxWidth: 560, margin: '0 auto', width: '100%' }}>
      <style>{PF_CSS}</style>
      <PfStudentHeader onBack={onClose} name={row.student.name} sub={`${row.sport} · ${row.batchLabel}`} />

      {programCards.length === 0 && (
        <PfEmpty icon="clipboardList">No programs set up for {row.sport} yet.</PfEmpty>
      )}

      {programCards.map(pc => {
        const isOpen = expandedProgram === pc.program.id;
        return (
          <div key={pc.program.id} style={{ ...pfCardStyle, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: '#182238', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{pc.program.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: '#64748B', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <PfIcon name="clock" size={13} /> {pc.program.frequency || 'weekly'} entry
                  </span>
                  {pc.missing.length > 0 && <PfBadge tone="danger">{pc.missing.length} missing</PfBadge>}
                </div>
              </div>
              <button
                type="button"
                className="pf-btn"
                onClick={() => pc.canAdd && onAddPoints(pc.program.id)}
                disabled={!pc.canAdd}
                style={{
                  height: 36, padding: '0 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: pc.canAdd ? '#1A336A' : 'var(--card2)',
                  color: pc.canAdd ? '#fff' : 'var(--gray)',
                  border: pc.canAdd ? 'none' : '1px solid var(--border)',
                  cursor: pc.canAdd ? 'pointer' : 'not-allowed',
                }}
              >
                <PfIcon name="plus" size={15} stroke={2.4} /> Add Points
              </button>
            </div>

            {/* last entry */}
            {pc.lastEntry ? (
              <div
                className="pf-head"
                role="button" tabIndex={0} aria-expanded={isOpen}
                onClick={() => setExpandedProgram(isOpen ? null : pc.program.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedProgram(isOpen ? null : pc.program.id); } }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0 2px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#182238', overflowWrap: 'anywhere' }}>{pc.lastEntry.challengeName}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 1, overflowWrap: 'anywhere' }}>
                    {(pc.lastEntry.date || '').slice(0, 10)} · by {pc.lastEntry.by}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <b style={{ color: '#1A336A', fontSize: 15 }}>+{pc.lastEntry.points}</b>
                  <span style={{ display: 'flex', color: '#94A3B8', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                    <PfIcon name="chevronRight" size={18} />
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--gray)', padding: '10px 0 2px', borderTop: '1px solid var(--border)' }}>
                No entries yet — due now.
              </div>
            )}

            {!pc.due && (
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <PfIcon name="calendar" size={13} /> Next entry opens {pc.dueDate.toISOString().slice(0, 10)}
              </div>
            )}

            {/* history list — tap last entry to expand */}
            {isOpen && pc.history.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1A336A', marginBottom: 4 }}>Previous entries</div>
                {pc.history.map(h => (
                  <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 12.5, borderTop: '1px solid var(--border)' }}>
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{h.challengeName} <span style={{ color: 'var(--gray)' }}>· by {h.by}</span></span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ color: 'var(--gray)', fontSize: 12 }}>{(h.date || '').slice(0, 10)}</span>
                      <b style={{ color: '#1A336A' }}>+{h.points}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
