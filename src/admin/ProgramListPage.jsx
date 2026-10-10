import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import PanelWindow from '../components/PanelWindow';
import { pfActionBtn as pfActionBtnLocal, PfIcon, PfBadge, PfEmpty, PfPageHeader, PF_CSS, pfCardStyle, pfCtl, pfOutlineBtn, pfPrimaryBtn, pfIconBtn, pfDangerIconBtn } from './perfUi';

function todayIso() { return new Date().toISOString().slice(0, 10); }

// A program is "completed" once its to_date has passed. No to_date = always
// in-progress (open-ended). This mirrors what PerformancePage uses to decide
// whether a program still counts toward the live leaderboard.
function isCompleted(p) {
  return !!p.to_date && p.to_date < todayIso();
}

export default function ProgramListPage() {
  const { academyId, isAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [programs, setPrograms] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openProgram, setOpenProgram] = useState(null);

  const load = async () => {
    if (!academyId) return;
    setLoading(true);
    const [progRes, chalRes] = await Promise.all([
      supabase.from('programs').select('*').eq('academy_id', academyId),
      supabase.from('program_challenges').select('*').eq('academy_id', academyId),
    ]);
    setPrograms(progRes.data || []);
    setChallenges(chalRes.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [academyId]); // eslint-disable-line

  if (!isAdmin) return null; // staff never reach this route

  const inProgress = programs.filter(p => !isCompleted(p))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const completed = programs.filter(isCompleted)
    .sort((a, b) => (b.to_date || '').localeCompare(a.to_date || ''));
  const ordered = [...inProgress, ...completed];

  const deleteProgram = async (p) => {
    if (!confirm(`Delete program "${p.name}" and all its challenges?`)) return;
    const { error } = await supabase.from('programs').delete().eq('id', p.id);
    if (error) { alert('Failed: ' + error.message); return; }
    setOpenProgram(null);
    load();
  };

  return (
    <div className="page active" style={{ paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
      <style>{PF_CSS}</style>
      <PfPageHeader icon="trophy" title="Programs">
        <button type="button" className="pf-btn" style={pfOutlineBtn} onClick={() => navigate('/admin/performance')}>
          <PfIcon name="arrowLeft" size={15} /> Back
        </button>
      </PfPageHeader>

      {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20, fontSize: 13 }}>Loading…</div>}

      {!loading && ordered.map(p => {
        const count = challenges.filter(c => c.program_id === p.id).length;
        const completedBadge = isCompleted(p);
        const metaItem = { display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 };
        return (
          <div
            key={p.id}
            className="pf-card"
            role="button" tabIndex={0}
            style={{ ...pfCardStyle, padding: '12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: completedBadge ? 'var(--card2)' : 'var(--card)' }}
            onClick={() => setOpenProgram(p)}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpenProgram(p); } }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
                <span style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.25, color: completedBadge ? '#475569' : '#182238', overflowWrap: 'anywhere' }}>{p.name}</span>
                {completedBadge
                  ? <PfBadge tone="neutral" icon="check">Completed</PfBadge>
                  : <PfBadge tone="success" icon="clock">In progress</PfBadge>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: '#64748B', marginTop: 6 }}>
                <span style={metaItem}><PfIcon name="layers" size={13} /> {p.sport}</span>
                <span style={metaItem}><PfIcon name="clipboardList" size={13} /> {count} challenge{count !== 1 ? 's' : ''}</span>
                <span style={{ ...metaItem, textTransform: 'capitalize' }}><PfIcon name="clock" size={13} /> {p.frequency}</span>
                {p.to_date && <span style={metaItem}><PfIcon name="calendar" size={13} /> Ends {p.to_date}</span>}
              </div>
            </div>
            <span style={{ display: 'flex', color: '#94A3B8', flexShrink: 0 }}><PfIcon name="chevronRight" size={20} /></span>
          </div>
        );
      })}
      {!loading && ordered.length === 0 && <PfEmpty icon="clipboardList">No programs created yet.</PfEmpty>}

      {openProgram && (
        <ProgramDetailPanel
          program={openProgram}
          challenges={challenges.filter(c => c.program_id === openProgram.id)}
          academyId={academyId}
          userId={user?.id}
          onClose={() => setOpenProgram(null)}
          onDeleteProgram={() => deleteProgram(openProgram)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// Same drill-in challenge management as before — unchanged from
// ProgramManagerModal's detail panel, just reused here.
function ProgramDetailPanel({ program, challenges, academyId, userId, onClose, onDeleteProgram, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [addingChallenge, setAddingChallenge] = useState(false);
  const [challengeName, setChallengeName] = useState('');
  const [challengePoints, setChallengePoints] = useState('');
  const [editingChallenge, setEditingChallenge] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPoints, setEditPoints] = useState('');

  const addChallenge = async () => {
    if (!challengeName.trim() || !challengePoints) return;
    setBusy(true);
    const { error } = await supabase.from('program_challenges').insert({
      program_id: program.id, academy_id: academyId, sport: program.sport,
      name: challengeName.trim(), total_points: Number(challengePoints), created_by_id: userId,
    });
    setBusy(false);
    if (error) { alert('Failed: ' + error.message); return; }
    setChallengeName(''); setChallengePoints(''); setAddingChallenge(false);
    onChanged?.();
  };

  const saveEditChallenge = async (c) => {
    if (!editName.trim() || !editPoints) return;
    setBusy(true);
    const { error } = await supabase.from('program_challenges')
      .update({ name: editName.trim(), total_points: Number(editPoints), updated_at: new Date().toISOString() })
      .eq('id', c.id);
    setBusy(false);
    if (error) { alert('Failed: ' + error.message); return; }
    setEditingChallenge(null);
    onChanged?.();
  };

  const deleteChallenge = async (c) => {
    if (!confirm(`Delete challenge "${c.name}"?`)) return;
    const { error } = await supabase.from('program_challenges').delete().eq('id', c.id);
    if (error) { alert('Failed: ' + error.message); return; }
    onChanged?.();
  };

  return (
    <PanelWindow onClose={onClose}>
      <div className="modal" style={{ width: '100%', maxWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 0, margin: 0 }}>
        <style>{PF_CSS}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(91,124,196,.12)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <PfIcon name="clipboardList" size={18} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 17, color: '#182238', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{program.name}</span>
          </div>
          <button type="button" className="pf-iconbtn" onClick={onClose} aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
            <PfIcon name="x" size={16} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 2px calc(8px + env(safe-area-inset-bottom, 0px))' }}>
          <div style={{ ...pfCardStyle, padding: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
              <span style={{ textTransform: 'capitalize' }}>{program.sport} · {program.frequency}</span>
              {program.from_date ? ` · ${program.from_date} → ${program.to_date || 'open'}` : ''}
              {' · '}{program.attendance_weight ?? 50}/{100 - (program.attendance_weight ?? 50)} split
            </div>
            <button type="button" className="pf-btn" style={{ ...pfActionBtnLocal, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }} onClick={onDeleteProgram}>
              <PfIcon name="trash" size={15} /> Delete
            </button>
          </div>

          {challenges.map(c => (
            <div key={c.id} style={{ ...pfCardStyle, padding: 10, marginBottom: 8 }}>
              {editingChallenge === c.id ? (
                <div>
                  <input className="form-input pf-field" aria-label="Challenge name" style={{ ...pfCtl, marginBottom: 6 }} value={editName} onChange={e => setEditName(e.target.value)} />
                  <input className="form-input pf-field" aria-label="Total points" type="number" style={{ ...pfCtl, marginBottom: 8 }} value={editPoints} onChange={e => setEditPoints(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="pf-btn" style={{ ...pfOutlineBtn, flex: 1, height: 40 }} onClick={() => setEditingChallenge(null)}>Cancel</button>
                    <button type="button" className="pf-btn" style={{ ...pfPrimaryBtn, flex: 1, height: 40 }} disabled={busy} onClick={() => saveEditChallenge(c)}>
                      <PfIcon name="check" size={15} /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#182238', overflowWrap: 'anywhere' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <PfIcon name="award" size={13} /> {c.total_points} pts
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button type="button" className="pf-iconbtn" style={pfIconBtn} aria-label={`Edit ${c.name}`} title="Edit"
                      onClick={() => { setEditingChallenge(c.id); setEditName(c.name); setEditPoints(String(c.total_points)); }}>
                      <PfIcon name="pencil" size={16} />
                    </button>
                    <button type="button" className="pf-iconbtn" style={pfDangerIconBtn} aria-label={`Delete ${c.name}`} title="Delete"
                      onClick={() => deleteChallenge(c)}>
                      <PfIcon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {challenges.length === 0 && <PfEmpty icon="clipboardList">No challenges yet.</PfEmpty>}

          {addingChallenge ? (
            <div style={{ ...pfCardStyle, padding: 10, marginTop: 6 }}>
              <input className="form-input pf-field" style={{ ...pfCtl, marginBottom: 6 }} placeholder="Challenge name" value={challengeName} onChange={e => setChallengeName(e.target.value)} />
              <input className="form-input pf-field" type="number" style={{ ...pfCtl, marginBottom: 8 }} placeholder="Total points" value={challengePoints} onChange={e => setChallengePoints(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="pf-btn" style={{ ...pfOutlineBtn, flex: 1, height: 40 }} onClick={() => setAddingChallenge(false)}>Cancel</button>
                <button type="button" className="pf-btn" style={{ ...pfPrimaryBtn, flex: 1, height: 40 }} disabled={busy} onClick={addChallenge}>
                  <PfIcon name="plus" size={15} stroke={2.4} /> Add
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="pf-btn" style={{ ...pfOutlineBtn, width: '100%', height: 42, marginTop: 4 }} onClick={() => setAddingChallenge(true)}>
              <PfIcon name="plus" size={15} stroke={2.4} /> Add Challenge
            </button>
          )}
        </div>
      </div>
    </PanelWindow>
  );
}
