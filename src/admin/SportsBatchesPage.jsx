import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { buildBatchKey } from '../lib/batchKey';

const CONFIRM_PHRASE = 'confirm delete';

export default function SportsBatchesPage() {
  const { sports, batches, students, refresh } = useAcademyData();
  const { academyId, appUser, isAdmin } = useAuth();
  const [newSport, setNewSport] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // sports currently expanded — more than one can be open

  // Sports and batches are name-locked once created (no rename). The only
  // editable field afterwards is a batch's default fee, and only for admins.
  const [editingFeeId, setEditingFeeId] = useState(null);
  const [editFeeValue, setEditFeeValue] = useState('');

  const [newBatchNames, setNewBatchNames] = useState({}); // { [sportId]: value } — one draft per sport since several can be expanded at once
  const [newBatchFees, setNewBatchFees] = useState({}); // { [sportId]: value } — default fee draft for the new batch
  const [error, setError] = useState('');

  // Delete confirmation modal state — shared by both sport and batch deletion.
  // { type: 'sport' | 'batch', id, label, sportName, affectedStudentCount }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [removeStudents, setRemoveStudents] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setRemoveStudents(false);
    setConfirmText('');
    setDeleting(false);
  };

  const addSport = async () => {
    if (!newSport.trim()) return;
    const { error: err } = await supabase.from('sports').insert({ name: newSport.trim(), academy_id: academyId });
    if (err) { setError(err.message); return; }
    setError('');
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Added sport ${newSport.trim()}` });
    setNewSport('');
    refresh();
  };

  // A student counts as "affected" if their primary batch field matches OR
  // any of their `enrollments` rows match — a student can be enrolled in a
  // sport/batch without it being their primary, so checking primary alone
  // would undercount (and under-delete) on cascade.
  const studentsForSport = (sportName) =>
    students.filter(st => st.sport === sportName || st.enrollments.some(en => en.sport === sportName));

  const studentsForBatch = (batchName) =>
    students.filter(st => st.batch === batchName || st.enrollments.some(en => en.batch === batchName));

  // Splits affected students into:
  //  - toDelete: every enrollment they have belongs to the thing being
  //    deleted, so the whole student row can go
  //  - toDetach: they have at least one OTHER enrollment elsewhere, so we
  //    must not delete the row — only strip the matching enrollment(s) and,
  //    if their primary batch pointed at the deleted sport/batch, repoint
  //    it to whatever enrollment remains (or clear it if none do)
  const splitStudentsForSport = (sportName) => {
    const affected = studentsForSport(sportName);
    const toDelete = [];
    const toDetach = [];
    for (const st of affected) {
      const remaining = st.enrollments.filter(en => en.sport !== sportName);
      if (remaining.length === 0) toDelete.push(st);
      else toDetach.push({ student: st, remaining });
    }
    return { toDelete, toDetach };
  };

  const splitStudentsForBatch = (batchName) => {
    const affected = studentsForBatch(batchName);
    const toDelete = [];
    const toDetach = [];
    for (const st of affected) {
      const remaining = st.enrollments.filter(en => en.batch !== batchName);
      if (remaining.length === 0) toDelete.push(st);
      else toDetach.push({ student: st, remaining });
    }
    return { toDelete, toDetach };
  };

  // Opens the confirm modal instead of deleting immediately.
  const requestDeleteSport = (s) => {
    const affectedStudents = studentsForSport(s.name);
    setDeleteTarget({ type: 'sport', id: s.id, label: s.name, sportName: s.name, affectedStudentCount: affectedStudents.length });
  };

  const requestDeleteBatch = (b, sport) => {
    const affectedStudents = studentsForBatch(b.name);
    setDeleteTarget({ type: 'batch', id: b.id, label: b.batchLabel, sportName: sport.name, batchName: b.name, affectedStudentCount: affectedStudents.length });
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setNewBatchNames(prev => { const next = { ...prev }; delete next[id]; return next; });
    setNewBatchFees(prev => { const next = { ...prev }; delete next[id]; return next; });
    setEditingFeeId(null);
  };

  const addBatch = async (sport) => {
    const value = (newBatchNames[sport.id] || '').trim();
    if (!value) return;
    // Only admins can set a default fee; for others the batch is created without one.
    let fee = null;
    if (isAdmin) {
      const raw = String(newBatchFees[sport.id] ?? '').trim();
      if (raw !== '') {
        fee = parseFee(raw);
        if (fee === null) { setError('Enter a valid default fee (0 or more).'); return; }
      }
    }
    const { error: err } = await supabase.from('batches').insert({ name: buildBatchKey(sport.name, value), academy_id: academyId, default_fee: fee });
    if (err) { setError(err.message); return; }
    setError('');
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Added batch ${value} to ${sport.name}${fee !== null ? ` (default fee ₹${fee})` : ''}` });
    setNewBatchNames(prev => ({ ...prev, [sport.id]: '' }));
    setNewBatchFees(prev => ({ ...prev, [sport.id]: '' }));
    refresh();
  };

  // Default fee helpers. Accepts the camelCase field from the data context
  // or the raw `default_fee` column.
  const feeOf = (b) => b.defaultFee ?? b.default_fee ?? null;
  const parseFee = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const formatFee = (fee) => (fee === null || fee === undefined ? 'Not set' : `₹${Number(fee).toLocaleString('en-IN')}`);

  const startEditFee = (b) => {
    if (!isAdmin) return;
    setEditingFeeId(b.id);
    setEditFeeValue(feeOf(b) ?? '');
  };
  const cancelEditFee = () => { setEditingFeeId(null); setEditFeeValue(''); };

  const saveEditFee = async (b, sport) => {
    if (!isAdmin) return; // admin-only, guarded in the UI too
    const raw = String(editFeeValue).trim();
    const fee = raw === '' ? null : parseFee(raw);
    if (raw !== '' && fee === null) { setError('Enter a valid default fee (0 or more).'); return; }
    if (fee === feeOf(b)) { cancelEditFee(); return; }

    const { error: err } = await supabase.from('batches').update({ default_fee: fee }).eq('id', b.id);
    if (err) { setError(err.message); return; }

    setError('');
    cancelEditFee();
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Set default fee for batch ${b.batchLabel} (${sport.name}) to ${fee === null ? 'none' : `₹${fee}`}` });
    refresh();
  };

  // Executes the actual deletion once the modal is confirmed.
  // Cascades to enrollments + students only if removeStudents was checked.
  const performDelete = async () => {
    if (!deleteTarget) return;
    if (removeStudents && confirmText.trim().toLowerCase() !== CONFIRM_PHRASE) return; // guarded by disabled button too

    setDeleting(true);
    try {
      if (deleteTarget.type === 'sport') {
        const sportName = deleteTarget.sportName;
        const affectedBatches = batches.filter(b => b.sport === sportName);

        if (removeStudents) {
          const { toDelete, toDetach } = splitStudentsForSport(sportName);
          const deleteIds = toDelete.map(st => st.id);
          const detachIds = toDetach.map(({ student }) => student.id);

          // Deepest-dependency tables first. For students whose row is being
          // fully deleted, wipe ALL their fees/attendance regardless of
          // sport (the row won't exist to reference anyway). For students
          // being kept (enrolled elsewhere too), only remove the
          // fees/attendance tied to THIS sport — their other sport's
          // records must survive.
          if (deleteIds.length > 0) {
            await supabase.from('attendance').delete().in('student_id', deleteIds);
            await supabase.from('fees').delete().in('student_id', deleteIds);
          }
          if (detachIds.length > 0) {
            await supabase.from('attendance').delete().eq('sport', sportName).in('student_id', detachIds);
            await supabase.from('fees').delete().eq('sport', sportName).in('student_id', detachIds);
          }

          // Enrollments first (references students), then students, then
          // batches, then the sport itself — deleting in dependency order
          // so nothing is left pointing at an already-removed row.
          await supabase.from('enrollments').delete().eq('sport', sportName);
          if (toDelete.length > 0) {
            await supabase.from('students').delete().in('id', deleteIds);
          }
          // Students who are ALSO enrolled elsewhere keep their row — just
          // repoint their primary batch to a remaining enrollment (or clear
          // it if somehow none is left) so they don't point at a sport that
          // no longer exists.
          await Promise.all(toDetach.map(({ student, remaining }) =>
            supabase.from('students').update({ batch: remaining[0]?.batch ?? null }).eq('id', student.id)
          ));
        }
        if (affectedBatches.length > 0) {
          await supabase.from('batches').delete().in('id', affectedBatches.map(b => b.id));
        }
        const { error: err } = await supabase.from('sports').delete().eq('id', deleteTarget.id);
        if (err) throw err;

        logActivity({
          academyId, actorId: appUser?.id, actorName: appUser?.name,
          message: removeStudents
            ? `Deleted sport ${sportName} with ${affectedBatches.length} batch(es) and all associated student records`
            : `Deleted sport ${sportName} (batches left orphaned)`,
        });
        setExpandedIds(prev => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      } else {
        const { batchName, sportName, id, label } = deleteTarget;

        if (removeStudents) {
          const { toDelete, toDetach } = splitStudentsForBatch(batchName);
          const deleteIds = toDelete.map(st => st.id);
          const detachIds = toDetach.map(({ student }) => student.id);

          if (deleteIds.length > 0) {
            await supabase.from('attendance').delete().in('student_id', deleteIds);
            await supabase.from('fees').delete().in('student_id', deleteIds);
          }
          if (detachIds.length > 0) {
            // attendance.batch and fees.batch_label both store the plain
            // batch label (not the "Sport::Label" composite), scoped by
            // sport separately, so both columns are needed to isolate just
            // this one batch and leave the student's other batch untouched.
            await supabase.from('attendance').delete().eq('sport', sportName).eq('batch', label).in('student_id', detachIds);
            await supabase.from('fees').delete().eq('sport', sportName).eq('batch_label', label).in('student_id', detachIds);
          }

          await supabase.from('enrollments').delete().eq('sport', sportName).eq('batch', label);
          if (toDelete.length > 0) {
            await supabase.from('students').delete().in('id', deleteIds);
          }
          await Promise.all(toDetach.map(({ student, remaining }) =>
            supabase.from('students').update({ batch: remaining[0]?.batch ?? null }).eq('id', student.id)
          ));
        }
        const { error: err } = await supabase.from('batches').delete().eq('id', id);
        if (err) throw err;

        logActivity({
          academyId, actorId: appUser?.id, actorName: appUser?.name,
          message: removeStudents
            ? `Deleted batch ${label} (${sportName}) and all associated student records`
            : `Deleted batch ${label} (${sportName})`,
        });
      }
      setError('');
      refresh();
      closeDeleteModal();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  const confirmDisabled = deleting || (removeStudents && confirmText.trim().toLowerCase() !== CONFIRM_PHRASE);

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/profile" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Profile</Link>
      <div className="section-title" style={{ marginBottom: 10 }}>🥋 Sports & Batches</div>

      {error && (
        <div style={{ fontSize: 12.5, color: '#dc2626', background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.25)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, flexShrink: 0 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexShrink: 0 }}>
        <input className="form-input" placeholder="New sport name" value={newSport} onChange={e => setNewSport(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={addSport}>Add</button>
      </div>

      {sports.map(s => {
        const isExpanded = expandedIds.has(s.id);
        const sportBatches = batches.filter(b => b.sport === s.name);
        const sportStudentCount = students.filter(st => st.sport === s.name).length;

        return (
          <div key={s.id} className="card" style={{ padding: 0, marginBottom: 8, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div
                onClick={() => toggleExpand(s.id)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <span style={{ fontSize: 12, color: 'var(--gray)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--gray)' }}>({sportBatches.length} batch{sportBatches.length === 1 ? '' : 'es'} · {sportStudentCount} student{sportStudentCount === 1 ? '' : 's'})</span>
              </div>
              <button className="btn btn-xs" style={{ background: 'var(--red)', color: '#fff', border: 'none' }} onClick={() => requestDeleteSport(s)}>Delete</button>
            </div>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border)', padding: 12, background: 'var(--card2)' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    className="form-input"
                    placeholder="New batch name"
                    value={newBatchNames[s.id] || ''}
                    onChange={e => setNewBatchNames(prev => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addBatch(s); }}
                  />
                  {isAdmin && (
                    <input
                      className="form-input"
                      style={{ width: 110 }}
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="Default fee ₹"
                      value={newBatchFees[s.id] ?? ''}
                      onChange={e => setNewBatchFees(prev => ({ ...prev, [s.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addBatch(s); }}
                    />
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => addBatch(s)}>Add</button>
                </div>
                {sportBatches.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--gray)', textAlign: 'center', padding: '8px 0' }}>No batches yet for {s.name}.</div>
                )}
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {sportBatches.map(b => {
                  const isEditingFee = editingFeeId === b.id;
                  const batchStudentCount = students.filter(st => st.batch === b.name).length;
                  return (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 13.5, flex: 1 }}>
                        {b.batchLabel} <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--gray)' }}>({batchStudentCount} student{batchStudentCount === 1 ? '' : 's'})</span>
                      </span>
                      {isEditingFee ? (
                        <>
                          <input
                            className="form-input"
                            style={{ width: 90 }}
                            type="number"
                            min="0"
                            inputMode="decimal"
                            placeholder="Fee ₹"
                            value={editFeeValue}
                            autoFocus
                            onChange={e => setEditFeeValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEditFee(b, s); if (e.key === 'Escape') cancelEditFee(); }}
                          />
                          <button className="btn btn-primary btn-xs" onClick={() => saveEditFee(b, s)}>Save</button>
                          <button className="btn btn-xs" onClick={cancelEditFee}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--gray)' }}>Fee: <strong style={{ color: 'var(--offwhite)' }}>{formatFee(feeOf(b))}</strong></span>
                          {isAdmin && <button className="btn btn-xs" onClick={() => startEditFee(b)}>✏️ Fee</button>}
                          <button className="btn btn-xs" style={{ background: 'var(--red)', color: '#fff', border: 'none' }} onClick={() => requestDeleteBatch(b, s)}>Delete</button>
                        </>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {deleteTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
          }}
          onClick={closeDeleteModal}
        >
          <div
            className="card"
            style={{ maxWidth: 400, width: '100%', padding: 18 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
              Delete {deleteTarget.type === 'sport' ? 'sport' : 'batch'} "{deleteTarget.label}"?
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginBottom: 12 }}>
              {deleteTarget.type === 'sport'
                ? 'This removes the sport itself. By default its batches are left in place but orphaned.'
                : 'This removes the batch itself.'}
              {deleteTarget.affectedStudentCount > 0 && (
                <> There {deleteTarget.affectedStudentCount === 1 ? 'is' : 'are'} <strong>{deleteTarget.affectedStudentCount}</strong> student record{deleteTarget.affectedStudentCount === 1 ? '' : 's'} currently under it.</>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={removeStudents}
                onChange={e => { setRemoveStudents(e.target.checked); setConfirmText(''); }}
                style={{ marginTop: 2 }}
              />
              <span>
                Also permanently delete student record{deleteTarget.affectedStudentCount === 1 ? '' : 's'}, plus their fees and attendance history, under this {deleteTarget.type === 'sport' ? 'sport' : 'batch'}. Students enrolled elsewhere too will keep their record — only this enrollment (and its fees/attendance) is removed. This cannot be undone.
              </span>
            </label>

            {removeStudents && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>
                  Type <strong>"{CONFIRM_PHRASE}"</strong> below to confirm permanent deletion of student records.
                </div>
                <input
                  className="form-input"
                  style={{ width: '100%' }}
                  placeholder={CONFIRM_PHRASE}
                  value={confirmText}
                  autoFocus
                  onChange={e => setConfirmText(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-xs" onClick={closeDeleteModal} disabled={deleting}>Cancel</button>
              <button
                className="btn btn-xs"
                style={{ background: 'var(--red)', color: '#fff', border: 'none', opacity: confirmDisabled ? 0.5 : 1 }}
                onClick={performDelete}
                disabled={confirmDisabled}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
