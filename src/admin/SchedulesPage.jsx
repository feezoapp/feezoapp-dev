import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SchedulesPage() {
  const { academyId } = useAuth();
  const { batches } = useAcademyData();
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState({ batch: batches[0]?.name || '', day: 'Mon', start_time: '', end_time: '' });

  const load = async () => {
    if (!academyId) return;
    const { data } = await supabase.from('week_schedules').select('*').eq('academy_id', academyId);
    setSchedules(data || []);
  };
  useEffect(() => { load(); }, [academyId]);

  const addSchedule = async () => {
    if (!form.batch || !form.start_time) return;
    await supabase.from('week_schedules').insert({ ...form, academy_id: academyId });
    load();
  };

  const removeSchedule = async (id) => {
    await supabase.from('week_schedules').delete().eq('id', id);
    load();
  };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/profile" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Profile</Link>
      <div className="section-title" style={{ marginBottom: 10 }}>🗓️ Weekly Schedules</div>

      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select className="form-select" value={form.batch} onChange={e => setForm({ ...form, batch: e.target.value })}>
          {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
        <select className="form-select" value={form.day} onChange={e => setForm({ ...form, day: e.target.value })}>
          {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="form-input" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
          <input className="form-input" type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={addSchedule}>Add Slot</button>
      </div>

      {DAYS.map(day => {
        const dayItems = schedules.filter(s => s.day === day);
        if (!dayItems.length) return null;
        return (
          <div key={day} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{day}</div>
            {dayItems.map(s => (
              <div key={s.id} className="card" style={{ padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.batch} · {s.start_time}–{s.end_time}</span>
                <button className="btn btn-xs" style={{ background: 'var(--red)', color: '#fff', border: 'none' }} onClick={() => removeSchedule(s.id)}>✕</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
