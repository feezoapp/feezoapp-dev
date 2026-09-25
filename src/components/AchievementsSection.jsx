import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const LEVELS = ['School', 'District', 'State', 'National', 'International'];
const RESULTS = ['Gold', 'Silver', 'Bronze', '1st', '2nd', '3rd', 'Participated'];

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AchievementsSection({ studentId, academyId, canEdit }) {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    event_name: '', level: LEVELS[0], result: RESULTS[0],
    achievement_date: todayIso(), category: '', notes: '',
  });

  const load = async () => {
    const { data } = await supabase.from('achievements').select('*')
      .eq('student_id', studentId).order('achievement_date', { ascending: false });
    setItems(data || []);
  };
  useEffect(() => { load(); }, [studentId]);

  const save = async () => {
    if (!form.event_name) return;
    setSaving(true);
    await supabase.from('achievements').insert({ ...form, student_id: studentId, academy_id: academyId });
    setSaving(false);
    setForm({ event_name: '', level: LEVELS[0], result: RESULTS[0], achievement_date: todayIso(), category: '', notes: '' });
    setShowForm(false);
    load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this achievement?')) return;
    await supabase.from('achievements').delete().eq('id', id);
    load();
  };

  const resultColor = (r) => {
    if (r === 'Gold' || r === '1st') return '#d4a017';
    if (r === 'Silver' || r === '2nd') return '#9ca3af';
    if (r === 'Bronze' || r === '3rd') return '#c07a3e';
    return 'var(--gray)';
  };

  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: 'var(--gray)', fontSize: 12, fontWeight: 700 }}>🏅 Achievements ({items.length})</div>
        {canEdit && (
          <button className="btn btn-xs btn-outline" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="form-input" placeholder="Event / competition name" value={form.event_name}
            onChange={e => setForm({ ...form, event_name: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-select" style={{ flex: 1 }} value={form.level}
              onChange={e => setForm({ ...form, level: e.target.value })}>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select className="form-select" style={{ flex: 1 }} value={form.result}
              onChange={e => setForm({ ...form, result: e.target.value })}>
              {RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" type="date" style={{ flex: 1 }} value={form.achievement_date}
              onChange={e => setForm({ ...form, achievement_date: e.target.value })} />
            <input className="form-input" placeholder="Category (optional)" style={{ flex: 1 }} value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })} />
          </div>
          <textarea className="form-input" placeholder="Notes (optional)" value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Achievement'}
          </button>
        </div>
      )}

      {items.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: 'var(--gray)', textAlign: 'center', padding: '10px 0' }}>No achievements recorded yet.</div>
      )}

      {items.map(a => (
        <div key={a.id} className="card" style={{ padding: 10, marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🏅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{a.event_name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>
              <span style={{ color: resultColor(a.result), fontWeight: 700 }}>{a.result}</span>
              {a.level && ` · ${a.level}`}
              {a.category && ` · ${a.category}`}
              {a.achievement_date && ` · ${a.achievement_date}`}
            </div>
            {a.notes && <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 4 }}>{a.notes}</div>}
          </div>
          {canEdit && (
            <button onClick={() => remove(a.id)} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
