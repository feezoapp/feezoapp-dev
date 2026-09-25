import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';

export default function CoursesPage() {
  const { academyId, appUser } = useAuth();
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', price: '' });

  const load = async () => {
    if (!academyId) return;
    const { data } = await supabase.from('courses').select('*').eq('academy_id', academyId);
    setCourses(data || []);
  };
  useEffect(() => { load(); }, [academyId]);

  const addCourse = async () => {
    if (!form.title) return;
    await supabase.from('courses').insert({ ...form, academy_id: academyId });
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Added course ${form.title}` });
    setForm({ title: '', description: '', price: '' });
    load();
  };

  const removeCourse = async (id) => {
    if (!confirm('Delete this course?')) return;
    const courseTitle = courses.find(c => c.id === id)?.title;
    await supabase.from('courses').delete().eq('id', id);
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Deleted course ${courseTitle || id}` });
    load();
  };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/profile" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Profile</Link>
      <div className="section-title" style={{ marginBottom: 10 }}>📚 Courses</div>

      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="form-input" placeholder="Course title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        <textarea className="form-input" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <input className="form-input" type="number" placeholder="Price" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={addCourse}>Add Course</button>
      </div>

      {courses.map(c => (
        <div key={c.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{c.title}</div>
          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{c.description}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>₹{c.price}</div>
          <button className="btn btn-xs" style={{ marginTop: 8, background: 'var(--red)', color: '#fff', border: 'none' }} onClick={() => removeCourse(c.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
