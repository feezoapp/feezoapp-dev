import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function LeaveCountPage() {
  const { academyId } = useAuth();
  const { visibleStudents } = useAcademyData();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [leaves, setLeaves] = useState([]);

  useEffect(() => {
    (async () => {
      if (!academyId) return;
      let query = supabase.from('leave_requests').select('*').eq('academy_id', academyId);
      if (dateFrom) query = query.gte('date', dateFrom);
      if (dateTo) query = query.lte('date', dateTo);
      const { data } = await query;
      setLeaves(data || []);
    })();
  }, [academyId, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const map = {};
    leaves.forEach(l => { map[l.student_id] = (map[l.student_id] || 0) + 1; });
    return Object.entries(map)
      .map(([id, count]) => ({ student: visibleStudents.find(s => s.id === id), count }))
      .filter(r => r.student)
      .sort((a, b) => b.count - a.count);
  }, [leaves, visibleStudents]);

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/profile" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Profile</Link>
      <div className="section-title" style={{ marginBottom: 10 }}>🌴 Leave Count</div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <input type="date" className="form-input" style={{ flex: 1, fontSize: 12 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ fontSize: 11, color: 'var(--gray)' }}>to</span>
        <input type="date" className="form-input" style={{ flex: 1, fontSize: 12 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="btn btn-outline btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>✕</button>
      </div>

      {counts.map(r => (
        <div key={r.student.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700 }}>{r.student.name}</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{r.student.sport} · {r.student.batch}</div>
          </div>
          <div style={{ fontWeight: 700, color: 'var(--orange)' }}>{r.count} days</div>
        </div>
      ))}
      {counts.length === 0 && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30 }}>No leave records in this range.</div>}
    </div>
  );
}
