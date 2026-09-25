import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { todayIso } from '../lib/calendarDate';
import PanelWindow from './PanelWindow';

const STATUS_COLOR = { approved: '#22c55e', rejected: '#ef4444', pending: 'var(--gray)' };

function dateColor(date) {
  const today = todayIso();
  if (date < today) return '#ef4444';   // crossed / overdue
  const d = new Date(today); d.setDate(d.getDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  if (date === today || date === tomorrow) return '#f97316';
  return 'var(--offwhite)';
}

export default function LeaveListModal({ academyId, isAdmin, userId, reviewerName, tasks, staffList, onClose, onChanged }) {
  const [leaves, setLeaves] = useState([]);
  const [adminIds, setAdminIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reassignFor, setReassignFor] = useState(null); // leave row currently choosing a reassignment target
  const [reassignTo, setReassignTo] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('leave_requests').select('*').eq('academy_id', academyId);
    if (!isAdmin) q = q.eq('staff_id', userId);
    const [{ data: leaveData }, { data: userData }] = await Promise.all([
      q,
      supabase.from('app_users').select('id, role').eq('academy_id', academyId),
    ]);
    setLeaves(leaveData || []);
    setAdminIds((userData || []).filter(u => (u.role || '').split(',').map(r => r.trim()).includes('admin')).map(u => u.id));
    setLoading(false);
  };
  useEffect(() => { load(); }, [academyId, isAdmin, userId]);

  const staffName = (id) => staffList.find(u => u.id === id)?.name || id;

  const grouped = useMemo(() => {
    const pending = leaves.filter(l => l.status === 'pending').sort((a, b) => a.date.localeCompare(b.date));
    const approved = leaves.filter(l => l.status === 'approved').sort((a, b) => b.date.localeCompare(a.date));
    const rejected = leaves.filter(l => l.status === 'rejected').sort((a, b) => b.date.localeCompare(a.date));
    return { pending, approved, rejected };
  }, [leaves]);

  // tasks that staff has on that date and would need reassignment
  const conflictsFor = (leave) => tasks.filter(t => t.staff_id === leave.staff_id && t.date === leave.date && t.status !== 'done' && t.status !== 'cancelled');

  const finalizeApprove = async (leave, reassignToId) => {
    if (leave.staff_id === userId) { alert('You cannot approve your own leave request — another admin needs to review it.'); return; }
    setBusyId(leave.id);
    try {
      if (reassignToId) {
        const conflictTasks = conflictsFor(leave);
        const ids = conflictTasks.map(t => t.id);
        if (ids.length) {
          const { error: taskErr } = await supabase.from('week_schedules').update({ staff_id: reassignToId }).in('id', ids);
          if (taskErr) throw taskErr;
          logActivity({ academyId, actorId: userId, actorName: 'Admin', message: `Reassigned ${ids.length} task(s) from ${staffName(leave.staff_id)} to ${staffName(reassignToId)} on ${leave.date}` });
        }
      }
      const reviewedAt = new Date().toISOString();
      const { error } = await supabase.from('leave_requests').update({ status: 'approved', reviewed_by: reviewerName, reviewed_at: reviewedAt }).eq('id', leave.id);
      if (error) throw error;
      logActivity({ academyId, actorId: userId, actorName: 'Admin', message: `Approved leave for ${leave.staff_name} on ${leave.date}` });
      setLeaves(prev => prev.map(l => l.id === leave.id ? { ...l, status: 'approved', reviewed_by: reviewerName, reviewed_at: reviewedAt } : l));
      setReassignFor(null);
      setReassignTo('');
      onChanged?.();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveClick = (leave) => {
    const conflicts = conflictsFor(leave);
    if (conflicts.length > 0) {
      setReassignFor(leave);
      setReassignTo('');
    } else {
      finalizeApprove(leave, null);
    }
  };

  const reject = async (leave) => {
    if (leave.staff_id === userId) { alert('You cannot reject your own leave request — another admin needs to review it.'); return; }
    setBusyId(leave.id);
    try {
      const reviewedAt = new Date().toISOString();
      const { error } = await supabase.from('leave_requests').update({ status: 'rejected', reviewed_by: reviewerName, reviewed_at: reviewedAt }).eq('id', leave.id);
      if (error) throw error;
      logActivity({ academyId, actorId: userId, actorName: 'Admin', message: `Rejected leave for ${leave.staff_name} on ${leave.date}` });
      setLeaves(prev => prev.map(l => l.id === leave.id ? { ...l, status: 'rejected', reviewed_by: reviewerName, reviewed_at: reviewedAt } : l));
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const Section = ({ title, items, showActions }) => {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent2)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 7 }}>{title} ({items.length})</div>
        {items.map(l => {
          const requesterIsAdmin = adminIds.includes(l.staff_id);
          const ownAdminRequest = requesterIsAdmin && l.staff_id === userId;
          return (
          <div key={l.id} className="card" style={{ padding: 11, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                {isAdmin && <div style={{ fontSize: 13, fontWeight: 800 }}>{l.staff_name || staffName(l.staff_id)}</div>}
                <div style={{ fontSize: 11.5, fontWeight: 700, color: dateColor(l.date) }}>📆 {l.date}</div>
                {l.reason && <div style={{ fontSize: 11.5, color: 'var(--gray)', fontStyle: 'italic', marginTop: 3 }}>{l.reason}</div>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, color: STATUS_COLOR[l.status], background: 'var(--card2)', borderRadius: 5, padding: '3px 7px', flexShrink: 0, textTransform: 'uppercase' }}>{l.status}</span>
            </div>

            {l.status !== 'pending' && l.reviewed_by && (
              <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 6 }}>
                {l.status === 'approved' ? '✅' : '❌'} by <b style={{ color: 'var(--offwhite)' }}>{l.reviewed_by}</b>
                {l.reviewed_at && ` · ${new Date(l.reviewed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
              </div>
            )}

            {showActions && isAdmin && ownAdminRequest && (
              <div style={{ marginTop: 9, fontSize: 11, color: '#b45309', background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 8, padding: '7px 9px' }}>
                ⚠️ This is your own leave request — another admin needs to review it.
              </div>
            )}

            {showActions && isAdmin && !ownAdminRequest && reassignFor?.id !== l.id && (
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                <button className="btn" style={{ flex: 1, fontSize: 11, padding: 7, background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44', fontWeight: 700 }}
                  disabled={busyId === l.id} onClick={() => handleApproveClick(l)}>✅ Approve</button>
                <button className="btn" style={{ flex: 1, fontSize: 11, padding: 7, background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444', fontWeight: 700 }}
                  disabled={busyId === l.id} onClick={() => reject(l)}>✕ Reject</button>
              </div>
            )}

            {reassignFor?.id === l.id && (
              <div style={{ marginTop: 10, background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 8, padding: 9 }}>
                <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 7 }}>
                  ⚠️ {staffName(l.staff_id)} has {conflictsFor(l).length} task(s) on {l.date}. Reassign to:
                </div>
                <select className="form-select" style={{ width: '100%', fontSize: 12, marginBottom: 7 }} value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
                  <option value="">Select staff…</option>
                  {staffList.filter(u => u.id !== l.staff_id).map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" style={{ flex: 1, fontSize: 11, padding: 7, background: 'var(--card2)' }} onClick={() => { setReassignFor(null); setReassignTo(''); }}>Cancel</button>
                  <button className="btn btn-primary" style={{ flex: 1.4, fontSize: 11, padding: 7 }} disabled={!reassignTo || busyId === l.id}
                    onClick={() => finalizeApprove(l, reassignTo)}>Reassign & Approve</button>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  return (
    <PanelWindow onClose={onClose}>
      <div className="modal" style={{ width: '100%', maxWidth: 420, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-title">
          <span>🌴 Leave Requests</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20 }}>Loading…</div>
          ) : leaves.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 24 }}>No leave requests {isAdmin ? '' : 'yet'}.</div>
          ) : (
            <>
              <Section title="⏳ Pending" items={grouped.pending} showActions />
              <Section title="✅ Approved" items={grouped.approved} />
              <Section title="❌ Rejected" items={grouped.rejected} />
            </>
          )}
        </div>
      </div>
    </PanelWindow>
  );
}
