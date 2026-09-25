import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { todayIso } from '../lib/calendarDate';
import PanelWindow from './PanelWindow';

// Self-apply (any staff/admin applying for their own leave) always goes in
// as 'pending' — nobody can approve their own leave (see LeaveListModal).
// An admin picking a DIFFERENT staff member from the dropdown is recording
// leave administratively, so that path skips the pending queue, goes in
// pre-approved, and — like the approve flow in LeaveListModal — offers to
// reassign that staff's conflicting tasks for the days right away.
//
// Leave can now cover a range (From → To). The table still stores ONE ROW PER
// DAY, so LeaveListModal and everything else that reads leave_requests keeps
// working unchanged.

const MAX_DAYS = 60;
const DAY_MS = 86400000;

// 'YYYY-MM-DD' -> UTC ms (avoids timezone / DST drift)
const toUtc = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Inclusive list of ISO dates between from and to
const enumerateDates = (from, to) => {
  if (!from || !to) return [];
  const start = toUtc(from);
  const end = toUtc(to);
  if (end < start) return [];
  const out = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'
const fmt = iso => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export default function ApplyLeaveModal({ academyId, userId, userName, isAdmin, staffList, tasks, onClose, onSubmitted }) {
  const [targetStaffId, setTargetStaffId] = useState(userId);
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [showReassignStep, setShowReassignStep] = useState(false);

  // Leave already applied/approved for this staff inside the chosen range
  const [existingLeaves, setExistingLeaves] = useState([]);
  const [checking, setChecking] = useState(false);

  const actingForOther = isAdmin && targetStaffId !== userId;
  const targetName = actingForOther ? (staffList.find(u => u.id === targetStaffId)?.name || targetStaffId) : userName;

  const dates = useMemo(() => enumerateDates(fromDate, toDate), [fromDate, toDate]);
  const totalDays = dates.length;
  const rangeInvalid = !!fromDate && !!toDate && toDate < fromDate;
  const rangeTooLong = totalDays > MAX_DAYS;

  const tasksForTarget = useMemo(
    () => (tasks || []).filter(t => t.staff_id === targetStaffId),
    [tasks, targetStaffId]
  );
  const conflicts = useMemo(() => {
    const set = new Set(dates);
    return tasksForTarget.filter(t => set.has(t.date) && t.status !== 'done' && t.status !== 'cancelled');
  }, [tasksForTarget, dates]);

  // Earliest scheduled start time today for the target — self-apply only,
  // so a staff member can't sneak in leave once their day already started.
  // Doesn't apply when an admin is recording leave for someone else.
  const earliestTodayStart = tasksForTarget
    .filter(t => t.date === todayIso() && t.in_time && t.status !== 'done' && t.status !== 'cancelled')
    .map(t => t.in_time)
    .sort()[0];

  // Live check: does this staff already have pending/approved leave in the range?
  useEffect(() => {
    if (!fromDate || !toDate || rangeInvalid || rangeTooLong) { setExistingLeaves([]); return; }
    let cancelled = false;
    setChecking(true);
    supabase.from('leave_requests').select('date,status')
      .eq('academy_id', academyId).eq('staff_id', targetStaffId)
      .gte('date', fromDate).lte('date', toDate)
      .in('status', ['pending', 'approved'])
      .order('date', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setExistingLeaves(data || []);
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, [academyId, targetStaffId, fromDate, toDate, rangeInvalid, rangeTooLong]);

  const resetReassignStep = () => { setShowReassignStep(false); setReassignTo(''); };

  const onFromChange = value => {
    setFromDate(value);
    // keep "To" from ever being before "From"
    if (!toDate || toDate < value) setToDate(value);
    setError('');
    resetReassignStep();
  };

  const onToChange = value => {
    setToDate(value);
    setError('');
    resetReassignStep();
  };

  const rangeLabel = totalDays === 1 ? fmt(fromDate) : `${fmt(fromDate)} – ${fmt(toDate)}`;

  const finalizeSubmit = async () => {
    setSaving(true);
    try {
      // Re-check right before writing (someone may have added leave meanwhile)
      const { data: dupes, error: dupErr } = await supabase.from('leave_requests').select('date,status')
        .eq('academy_id', academyId).eq('staff_id', targetStaffId)
        .gte('date', fromDate).lte('date', toDate)
        .in('status', ['pending', 'approved'])
        .order('date', { ascending: true });
      if (dupErr) throw dupErr;
      if (dupes && dupes.length) {
        setExistingLeaves(dupes);
        setError(`Leave already applied on ${dupes.length} of these day${dupes.length > 1 ? 's' : ''}`);
        return;
      }

      if (actingForOther && reassignTo) {
        const ids = conflicts.map(t => t.id);
        if (ids.length) {
          const { error: taskErr } = await supabase.from('week_schedules').update({ staff_id: reassignTo }).in('id', ids);
          if (taskErr) throw taskErr;
          logActivity({ academyId, actorId: userId, actorName: userName, message: `Reassigned ${ids.length} task(s) from ${targetName} to ${staffList.find(u => u.id === reassignTo)?.name || reassignTo} for ${rangeLabel}` });
        }
      }

      const now = new Date().toISOString();
      const rows = dates.map(d => {
        const row = {
          id: crypto.randomUUID(),
          academy_id: academyId, staff_id: targetStaffId, staff_name: targetName, date: d,
          reason: reason.trim(), applied_at: now,
          status: actingForOther ? 'approved' : 'pending',
        };
        if (actingForOther) { row.reviewed_by = userName; row.reviewed_at = now; }
        return row;
      });

      // One insert call = all-or-nothing, so we never end up with half a range saved
      const { error: err } = await supabase.from('leave_requests').insert(rows);
      if (err) throw err;

      logActivity({
        academyId, actorId: userId, actorName: userName,
        message: actingForOther
          ? `Recorded leave for ${targetName} — ${rangeLabel} (${totalDays} day${totalDays > 1 ? 's' : ''})`
          : `Applied for leave — ${rangeLabel} (${totalDays} day${totalDays > 1 ? 's' : ''})`,
      });
      onSubmitted();
    } catch (err) {
      setError(err.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setError('');
    if (!fromDate || !toDate) { setError('Please select the from and to dates'); return; }
    if (rangeInvalid) { setError('"To" date cannot be before "From" date'); return; }
    if (rangeTooLong) { setError(`Leave can be applied for up to ${MAX_DAYS} days at a time`); return; }
    if (existingLeaves.length > 0) { setError('Leave already applied on some of these days'); return; }
    if (!reason.trim()) { setError('Please enter a reason'); return; }

    if (!actingForOther) {
      const today = todayIso();
      if (fromDate === today && earliestTodayStart) {
        const now = new Date();
        const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (nowHM >= earliestTodayStart) {
          setError(`Cannot apply for leave today — your task at ${earliestTodayStart} has already started`);
          return;
        }
      }
    }

    // Admin recording leave for someone else with conflicting tasks in the range:
    // offer reassignment before writing anything, same UX as approving from
    // the Leave Requests list.
    if (actingForOther && conflicts.length > 0 && !showReassignStep) {
      setShowReassignStep(true);
      return;
    }

    finalizeSubmit();
  };

  const submitDisabled = saving || checking || rangeInvalid || rangeTooLong || existingLeaves.length > 0;

  return (
    <PanelWindow onClose={onClose}>
      <div
        className="modal"
        style={{ width: '100%', maxWidth: 400, height: '100%', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
      >
        <div className="modal-title" style={{ padding: '16px 20px', flexShrink: 0, borderBottom: '1px solid var(--border)', margin: 0 }}>
          <span>🏖️ {isAdmin ? 'Apply / Record Leave' : 'Apply for Leave'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', minHeight: 0 }}>
          {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

          {isAdmin && (
            <div className="form-group">
              <label className="form-label">Leave For</label>
              <select
                className="form-select"
                value={targetStaffId}
                onChange={e => { setTargetStaffId(e.target.value); setError(''); resetReassignStep(); }}
              >
                <option value={userId}>{userName} (You)</option>
                {staffList.filter(u => u.id !== userId).map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.id}</option>
                ))}
              </select>
              {actingForOther && (
                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 3 }}>Recorded directly as approved — no separate review needed.</div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
              <label className="form-label">From Date</label>
              <input
                type="date" className="form-input" value={fromDate}
                onChange={e => onFromChange(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
              <label className="form-label">To Date</label>
              <input
                type="date" className="form-input" value={toDate}
                min={fromDate || undefined}
                onChange={e => onToChange(e.target.value)}
              />
            </div>
          </div>

          {!actingForOther && fromDate === todayIso() && earliestTodayStart && (
            <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: -6, marginBottom: 10 }}>Must be applied before {earliestTodayStart} today</div>
          )}

          {/* Total days */}
          {totalDays > 0 && !rangeTooLong && (
            <div style={{ background: '#3b82f612', border: '1px solid #3b82f633', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📅 Total leave</span>
              <b>{totalDays} day{totalDays > 1 ? 's' : ''}</b>
            </div>
          )}
          {rangeInvalid && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>"To" date cannot be before "From" date.</div>
          )}
          {rangeTooLong && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>Please choose {MAX_DAYS} days or fewer.</div>
          )}

          {/* Already-applied warning */}
          {existingLeaves.length > 0 && (
            <div style={{ background: '#ef444414', border: '1px solid #ef444455', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#b91c1c' }}>
              ⛔ {actingForOther ? targetName : 'You'} already {actingForOther ? 'has' : 'have'} leave applied on{' '}
              <b>{existingLeaves.length} day{existingLeaves.length > 1 ? 's' : ''}</b> in this range. Change the dates to continue:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {existingLeaves.map(l => (
                  <li key={l.date}>{fmt(l.date)} — {l.status === 'approved' ? 'Approved' : 'Pending'}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Reason</label>
            <textarea className="form-input" rows={3} style={{ resize: 'none' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Personal work, medical appointment…" />
          </div>

          {conflicts.length > 0 && !showReassignStep && (
            <div style={{ background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#b45309' }}>
              ⚠️ {actingForOther ? targetName : 'You'} {actingForOther ? 'has' : 'have'} <b>{conflicts.length} task{conflicts.length > 1 ? 's' : ''}</b> scheduled {totalDays > 1 ? 'in this period' : 'on this day'}.{' '}
              {actingForOther ? "You'll be asked to reassign them next." : 'Admin will be notified to reassign.'}
            </div>
          )}

          {showReassignStep && (
            <div style={{ background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 7 }}>
                ⚠️ {targetName} has {conflicts.length} task(s) on {rangeLabel}. Reassign to:
              </div>
              <select className="form-select" style={{ width: '100%', fontSize: 12, marginBottom: 7 }} value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
                <option value="">Leave as is / handle later</option>
                {staffList.filter(u => u.id !== targetStaffId).map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
          <button className="btn" style={{ flex: 1, background: 'var(--card2)' }} onClick={showReassignStep ? resetReassignStep : onClose}>
            {showReassignStep ? 'Back' : 'Cancel'}
          </button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={submit} disabled={submitDisabled}>
            {saving ? 'Saving…' : showReassignStep ? '✅ Confirm & Add Leave' : actingForOther ? '➕ Add Leave' : '📤 Submit Request'}
          </button>
        </div>
      </div>
    </PanelWindow>
  );
}
