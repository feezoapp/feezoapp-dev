import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import PanelWindow from '../components/PanelWindow';

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
    <div className="page active" style={{ paddingBottom: 90 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>🏆 Programs</div>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/performance')}>Back</button>
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20 }}>Loading…</div>}

      {!loading && ordered.map(p => {
        const count = challenges.filter(c => c.program_id === p.id).length;
        const completedBadge = isCompleted(p);
        return (
          <div
            key={p.id}
            className="card"
            style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', opacity: completedBadge ? 0.65 : 1 }}
            onClick={() => setOpenProgram(p)}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.name}
                {completedBadge && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray)', background: 'var(--card2)', borderRadius: 6, padding: '2px 6px' }}>COMPLETED</span>
                )}
                {!completedBadge && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#1a9e4c', background: '#1a9e4c22', borderRadius: 6, padding: '2px 6px' }}>IN PROGRESS</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                {p.sport} · {count} challenge{count !== 1 ? 's' : ''} · {p.frequency}
                {p.to_date ? ` · ends ${p.to_date}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 18, color: 'var(--gray)' }}>›</span>
          </div>
        );
      })}
      {!loading && ordered.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30, fontSize: 13 }}>No programs created yet.</div>
      )}

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
        <div className="modal-title">
          <span>{program.name}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0 2px' }}>
          <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>
              {program.sport} · {program.frequency}
              {program.from_date ? ` · ${program.from_date} → ${program.to_date || 'open'}` : ''}
              {' · '}{program.attendance_weight ?? 50}/{100 - (program.attendance_weight ?? 50)} split
            </div>
            <button className="btn btn-sm" style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444', fontSize: 11 }} onClick={onDeleteProgram}>
              🗑 Delete
            </button>
          </div>

          {challenges.map(c => (
            <div key={c.id} style={{ background: 'var(--card2)', borderRadius: 7, padding: 10, marginBottom: 8 }}>
              {editingChallenge === c.id ? (
                <div>
                  <input className="form-input" style={{ width: '100%', fontSize: 12, marginBottom: 5 }} value={editName} onChange={e => setEditName(e.target.value)} />
                  <input className="form-input" type="number" style={{ width: '100%', fontSize: 12, marginBottom: 6 }} value={editPoints} onChange={e => setEditPoints(e.target.value)} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" style={{ flex: 1, fontSize: 11, background: 'var(--card)' }} onClick={() => setEditingChallenge(null)}>Cancel</button>
                    <button className="btn btn-primary" style={{ flex: 1, fontSize: 11 }} disabled={busy} onClick={() => saveEditChallenge(c)}>Save</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--gray)' }}>{c.total_points} pts</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" style={{ fontSize: 10, padding: '4px 7px' }}
                      onClick={() => { setEditingChallenge(c.id); setEditName(c.name); setEditPoints(String(c.total_points)); }}>✏️</button>
                    <button className="btn btn-sm" style={{ fontSize: 10, padding: '4px 7px', background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
                      onClick={() => deleteChallenge(c)}>🗑</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {challenges.length === 0 && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 16, fontSize: 12 }}>No challenges yet.</div>}

          {addingChallenge ? (
            <div style={{ marginTop: 6 }}>
              <input className="form-input" style={{ width: '100%', fontSize: 12, marginBottom: 5 }} placeholder="Challenge name" value={challengeName} onChange={e => setChallengeName(e.target.value)} />
              <input className="form-input" type="number" style={{ width: '100%', fontSize: 12, marginBottom: 6 }} placeholder="Total points" value={challengePoints} onChange={e => setChallengePoints(e.target.value)} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" style={{ flex: 1, fontSize: 11, background: 'var(--card2)' }} onClick={() => setAddingChallenge(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1, fontSize: 11 }} disabled={busy} onClick={addChallenge}>Add</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-outline btn-sm" style={{ width: '100%', fontSize: 11, marginTop: 4 }} onClick={() => setAddingChallenge(true)}>+ Add Challenge</button>
          )}
        </div>
      </div>
    </PanelWindow>
  );
}
