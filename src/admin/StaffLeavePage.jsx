import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { isoToDisplay } from '../lib/calendarDate';
import PanelWindow from '../components/PanelWindow';

const STATUS_COLOR = { pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function StaffLeavePage() {
  const { academyId, isAdmin, user, appUser } = useAuth();
  const [requests, setRequests] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [reviewing, setReviewing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!academyId) return;
    setLoading(true);
    const [lr, us] = await Promise.all([
      supabase.from('leave_requests').select('*').eq('academy_id', academyId),
      supabase.from('app_users').select('*').eq('academy_id', academyId),
    ]);
    setRequests(lr.data || []);
    setStaffList(us.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [academyId]);

  const staffName = (id) => staffList.find(u => u.id === id)?.name || id;
  const adminIds = useMemo(() => staffList.filter(u => (u.role || '').split(',').map(r => r.trim()).includes('admin')).map(u => u.id), [staffList]);
  const isOwnRequest = (leave) => leave.staff_id === user?.id;

  const filtered = useMemo(() => {
    let list = isAdmin ? requests : requests.filter(l => l.staff_id === user?.id);
    if (dateFrom) list = list.filter(l => l.date >= dateFrom);
    if (dateTo) list = list.filter(l => l.date <= dateTo);
    if (statusFilter !== 'ALL') list = list.filter(l => l.status === statusFilter);
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [requests, isAdmin, user, dateFrom, dateTo, statusFilter]);

  const summary = useMemo(() => ({
    total: filtered.length,
    approved: filtered.filter(l => l.status === 'approved').length,
    pending: filtered.filter(l => l.status === 'pending').length,
    rejected: filtered.filter(l => l.status === 'rejected').length,
  }), [filtered]);

  const review = async (leave, status) => {
    if (isOwnRequest(leave)) { alert('You cannot review your own leave request — another admin needs to review it.'); return; }
    const { error } = await supabase.from('leave_requests').update({
      status, reviewed_by: appUser?.name || user?.email, reviewed_at: new Date().toISOString(),
    }).eq('id', leave.id);
    if (error) { alert('Failed: ' + error.message); return; }
    logActivity({
      academyId, actorId: appUser?.id, actorName: appUser?.name || user?.email,
      message: `${status === 'approved' ? 'Approved' : 'Rejected'} leave request for ${leave.staff_name} (${leave.date})`,
    });
    setRequests(prev => prev.map(l => l.id === leave.id ? { ...l, status, reviewed_by: appUser?.name || user?.email } : l));
    setReviewing(null);
  };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/calendar" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Calendar</Link>
      <div className="section-title" style={{ marginBottom: 10 }}>📊 Leave Requests</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <input type="date" className="form-input" style={{ flex: 1, minWidth: 110, fontSize: 12 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ fontSize: 11, color: 'var(--gray)', alignSelf: 'center' }}>to</span>
        <input type="date" className="form-input" style={{ flex: 1, minWidth: 110, fontSize: 12 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <select className="form-select" style={{ flex: 1, minWidth: 100, fontSize: 12 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {(dateFrom || dateTo) && <button className="btn btn-outline btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>✕</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        {[['Total', summary.total, 'var(--offwhite)'], ['Approved', summary.approved, '#22c55e'], ['Pending', summary.pending, '#f59e0b'], ['Rejected', summary.rejected, '#ef4444']].map(([label, val, color]) => (
          <div key={label} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20 }}>Loading…</div>}
      {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 13 }}>No leave requests found.</div>}

      {!loading && filtered.map(l => {
        const sc = STATUS_COLOR[l.status] || '#888';
        const canReview = isAdmin && l.status === 'pending' && !isOwnRequest(l);
        const ownPending = isAdmin && l.status === 'pending' && isOwnRequest(l);
        return (
          <div key={l.id} className="card" style={{ padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, cursor: canReview ? 'pointer' : 'default' }}
            onClick={() => canReview && setReviewing(l)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isAdmin && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--offwhite)' }}>{staffName(l.staff_id) || l.staff_name}</div>}
              <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{isoToDisplay(l.date)}</div>
              {l.reason && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{l.reason}</div>}
              {l.reviewed_by && (l.status === 'approved' || l.status === 'rejected') && (
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{l.status === 'approved' ? '✅ Approved' : '❌ Rejected'} by {l.reviewed_by}</div>
              )}
              {ownPending && (
                <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>⚠️ Your own request — another admin needs to review it</div>
              )}
            </div>
            {canReview
              ? <button className="btn btn-primary" style={{ fontSize: 11, padding: '6px 12px', flexShrink: 0 }} onClick={e => { e.stopPropagation(); setReviewing(l); }}>✅ Review</button>
              : <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: `${sc}22`, color: sc, border: `1px solid ${sc}44`, flexShrink: 0 }}>
                  {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                </span>}
          </div>
        );
      })}

      {reviewing && (
        <PanelWindow onClose={() => setReviewing(null)}>
          <div className="modal" style={{ width: '100%', maxWidth: 400, height: '100%', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            <div className="modal-title" style={{ padding: '16px 20px', flexShrink: 0, borderBottom: '1px solid var(--border)', margin: 0 }}>
              <span>📋 Leave Request</span>
              <button className="modal-close" onClick={() => setReviewing(null)}>×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', minHeight: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{staffName(reviewing.staff_id) || reviewing.staff_name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>📆 {isoToDisplay(reviewing.date)}</div>
              {reviewing.reason && <div style={{ fontSize: 13, color: 'var(--offwhite)', marginBottom: 14, background: 'var(--card2)', borderRadius: 8, padding: 10 }}>{reviewing.reason}</div>}
              {isOwnRequest(reviewing) && (
                <div style={{ fontSize: 12, color: '#b45309', background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 8, padding: '9px 11px' }}>
                  ⚠️ This is your own leave request — another admin needs to review it.
                </div>
              )}
            </div>
            {!isOwnRequest(reviewing) && (
              <div style={{ display: 'flex', gap: 8, padding: '14px 20px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
                <button className="btn" style={{ flex: 1, background: '#ef444422', color: '#f87171', border: '1px solid #ef444444' }} onClick={() => review(reviewing, 'rejected')}>❌ Reject</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => review(reviewing, 'approved')}>✅ Approve</button>
              </div>
            )}
          </div>
        </PanelWindow>
      )}
    </div>
  );
}
