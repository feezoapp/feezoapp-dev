import { useState } from 'react';

const LEVELS = ['School', 'District', 'State', 'National', 'International'];
const RESULTS = ['Gold', 'Silver', 'Bronze', '1st', '2nd', '3rd', 'Participated'];
const todayIso = () => new Date().toISOString().slice(0, 10);

// Same fields as AchievementsSection, but held in local state (no DB calls)
// until the parent form is saved and a real student_id exists.
export default function AchievementPicker({ items, setItems }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    event_name: '', level: LEVELS[0], result: RESULTS[0],
    achievement_date: todayIso(), category: '', notes: '',
  });

  const add = () => {
    if (!form.event_name) return;
    setItems([...items, { ...form, _tmpId: Date.now() }]);
    setForm({ event_name: '', level: LEVELS[0], result: RESULTS[0], achievement_date: todayIso(), category: '', notes: '' });
    setShowForm(false);
  };

  const remove = (tmpId) => setItems(items.filter(i => i._tmpId !== tmpId));

  const resultColor = (r) => {
    if (r === 'Gold' || r === '1st') return '#d4a017';
    if (r === 'Silver' || r === '2nd') return '#9ca3af';
    if (r === 'Bronze' || r === '3rd') return '#c07a3e';
    return 'var(--gray)';
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent2)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
          🏅 Achievements ({items.length})
        </span>
        <button type="button" className="btn btn-xs btn-outline" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add'}
        </button>
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
          <button type="button" className="btn btn-primary btn-sm" onClick={add}>Add to list</button>
        </div>
      )}

      {items.map(a => (
        <div key={a._tmpId} className="card" style={{ padding: 10, marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🏅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{a.event_name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>
              <span style={{ color: resultColor(a.result), fontWeight: 700 }}>{a.result}</span>
              {a.level && ` · ${a.level}`}
              {a.category && ` · ${a.category}`}
              {a.achievement_date && ` · ${a.achievement_date}`}
            </div>
          </div>
          <button type="button" onClick={() => remove(a._tmpId)} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✕</button>
        </div>
      ))}
    </div>
  );
}
