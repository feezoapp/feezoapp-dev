import { useEffect, useMemo, useRef, useState } from 'react';
import { useAcademyData } from '../context/AcademyDataContext';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import { supabase } from '../lib/supabaseClient';
import { logActivity } from '../lib/auditLog';
import { exportGenericPdf, exportGenericXlsx } from '../lib/exporters';
import SendMessageModal from '../components/SendMessageModal';
import { DEFAULT_MSG, DEFAULT_THANK } from '../components/FeeMsgModal';
import ImportFeesModal from '../components/ImportFeesModal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-indexed
// 'YYYY-MM' + d months -> 'YYYY-MM'
const stepMonthKey = (mk, d) => {
  const [y, m] = mk.split('-').map(Number);
  const idx = y * 12 + (m - 1) + d;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
};
const monthKeyLabel = (mk) => { const [y, m] = mk.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

// Supabase/PostgREST caps any single .select() at 1000 rows by default.
// Year view (or even Month view, for a busy academy) can have more
// attendance rows than that — a plain query would silently truncate,
// under-counting who's actually eligible for fees that period. Page
// through in 1000-row chunks instead of trusting one request to return
// everything. Matches AttendanceTab's identical fetchAllRows helper.
const PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// Trimmed + lowercased comparison so a stray space or casing difference
// between a sport/batch on a student's enrollment and the one used in a
// filter or on an attendance row doesn't cause a silent mismatch.
const norm = (v) => (v || '').toString().trim().toLowerCase();

// A composite key per enrollment (student + sport + batch) — matches the
// same pattern AttendanceTab uses, so a student with two enrollments (same
// or different sport) gets exactly one fee row per enrollment, never merged
// and never duplicated.
const keyFor = (studentId, sport, batchLabel) => `${studentId}::${norm(sport)}::${norm(batchLabel)}`;

// Same centered popup used by StudentsTab's / AttendanceTab's / HomeTab's
// Sport/Batch/Sort filters — a dark overlay + a card of radio rows, closing
// itself on selection.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 12, padding: 14, width: '85%', maxWidth: 320, maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--gray)', cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '7px 2px', cursor: 'pointer' }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

const STATUS_OPTIONS = [
  { v: 'outstanding', l: 'Unpaid + Partial' },
  { v: 'all', l: 'All Status' },
  { v: 'paid', l: 'Paid' },
  { v: 'partial', l: 'Partially Paid' },
  { v: 'unpaid', l: 'Unpaid' },
];

function buildMsg(tpl, ctx) {
  return tpl
    .replace(/{name}/g, ctx.name || '')
    .replace(/{month}/g, ctx.month || '')
    .replace(/{academy}/g, ctx.academy || '')
    .replace(/{amount}/g, ctx.amount != null ? String(ctx.amount) : '')
    .replace(/{method}/g, ctx.method || '');
}

// Returns 'unpaid' | 'partial' | 'paid' by comparing what's been paid
// (fee.amount, a running total) against the total owed (fee.amount_due).
// This is the single source of truth for a fee's state — the stored
// `status` column is kept in sync with this on every save, so filters/
// exports can read it directly without recomputing.
// Legacy rows saved before partial-payment support have no amount_due;
// those fall back to their old stored status so existing paid/unpaid
// history isn't reinterpreted.
function feeStatus(fee) {
  if (!fee) return 'unpaid';
  // A scholarship row is always treated as fully settled — the student
  // owes nothing, regardless of what amount_due/amount happen to hold.
  if (fee.is_scholarship) return 'paid';
  const due = parseInt(fee.amount_due, 10);
  const paid = parseInt(fee.amount, 10) || 0;
  if (!due || isNaN(due)) return (fee.status === 'paid' && paid > 0) ? 'paid' : 'unpaid';
  if (paid <= 0) return 'unpaid';
  if (paid >= due) return 'paid';
  return 'partial';
}
const isPaidEntry = (fee) => feeStatus(fee) === 'paid';
const isPartialEntry = (fee) => feeStatus(fee) === 'partial';

// Whether a fee row matches the currently selected status filter.
// 'outstanding' is a convenience bucket covering both unpaid and partially
// paid rows — it's the default view so staff land on students who still
// owe money instead of a full/all list.
function matchesStatusFilter(status, statusFilter) {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'outstanding') return status === 'unpaid' || status === 'partial';
  return status === statusFilter;
}

// Auto-generated, human-traceable transaction ID: TXN-<first 3 chars of the
// academy id>-<student roll number>-<zero-padded sequence>. The sequence is
// the student's running payment count across ALL their fee entries (every
// sport/batch/month), so it climbs 001, 002, 003... across their whole
// history rather than resetting per fee row.
function genTxnId(academyId, rollNo, seq) {
  const academyPart = (academyId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'ACD';
  const rollPart = (rollNo || 'NA').toString().toUpperCase();
  const seqPart = String(seq).padStart(3, '0');
  return `TXN-${academyPart}-${rollPart}-${seqPart}`;
}

// Staff can create a first-time entry and add further installments while
// the fee isn't yet fully paid. Once the full amount has been collected,
// only admin can reopen (reset) or otherwise touch it.
function canEditFee(fee, isAdmin) {
  if (isAdmin) return true;
  if (!fee) return true;
  return feeStatus(fee) !== 'paid';
}

// One form line with the label on the left and its input on the right
// (e.g. "Total Amount Due ₹ ........ 600"). `hint` is a small grey line
// under the label; `boxWidth` sets how wide the right-hand box is.
function FieldRow({ label, hint, boxWidth = 140, children }) {
  return (
    <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <label className="form-label" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
        {label}
        {hint && <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--gray)', marginTop: 2 }}>{hint}</div>}
      </label>
      <div style={{ width: boxWidth, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// Modal for creating/editing a single student's fee entry for a given
// month + sport + batch. Supports partial payments: the first save records
// the Total Amount Due plus whatever's being paid right now. If that's
// less than the total, the fee stays "Partially Paid" until enough
// installments bring it to the full amount — staff can only ADD a new
// installment (auto-totalled), never edit or overwrite what's already
// been collected. Once fully paid it locks; only admin can reset it.
function FeeEntryModal({ student, monthKey, monthLabel, sport, batchLabel, fee, nextTxnSeq, onClose, onSaved, onMultiMonth }) {
  const { academyId, appUser, user, isAdmin } = useAuth();
  const { visibleBatches } = useAcademyData();
  const status = feeStatus(fee);
  const due = fee?.amount_due ? parseInt(fee.amount_due, 10) : null;
  const paidSoFar = fee?.amount ? parseInt(fee.amount, 10) : 0;
  const remaining = due != null ? Math.max(due - paidSoFar, 0) : null;
  const payments = fee?.payments || [];
  const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
  const isFirstEntry = status === 'unpaid' && !due;
  const locked = status === 'paid' && !isAdmin;

  // Auto-generated transaction ID for whatever payment is about to be
  // recorded in this modal session. Computed once up front from the
  // student's running payment count so it's stable while the form is open.
  const txnId = genTxnId(academyId, student.roll_no, nextTxnSeq);

  // The batch's default fee (set by an admin on the Sports & Batches page)
  // pre-fills Total Amount Due on a first entry. It stays editable here so
  // a single student can still get a custom amount (discount, sibling, etc).
  const batchDefaultFee = useMemo(() => {
    const b = (visibleBatches || []).find(x => norm(x.sport) === norm(sport) && norm(x.batchLabel) === norm(batchLabel));
    const f = b ? (b.defaultFee ?? b.default_fee ?? null) : null;
    return f !== null && f !== undefined && Number(f) > 0 ? Number(f) : null;
  }, [visibleBatches, sport, batchLabel]);

  const [totalDue, setTotalDue] = useState(due ?? (isFirstEntry && batchDefaultFee != null ? String(batchDefaultFee) : ''));
  // 'full' | 'partial' | 'scholarship' — only meaningful once a total due
  // amount is known. Full Payment auto-fills the amount field with whatever's
  // left; Partial Payment leaves it to manual entry; Scholarship waives the
  // fee entirely — no amount, method, or transaction ID is collected.
  const [payType, setPayType] = useState('full');
  const [payNow, setPayNow] = useState('');
  const [method, setMethod] = useState(fee?.method || 'cash');
  const [note, setNote] = useState(''); // optional one-line note, stored on the payment entry
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  // Keep the amount field in sync with the Full/Partial toggle once we know
  // what's owed (i.e. after Total Due has been entered on a first entry, or
  // always for a follow-up installment where `remaining` is already known).
  useEffect(() => {
    const knownDue = isFirstEntry ? parseInt(totalDue, 10) : remaining;
    if (payType === 'full' && knownDue > 0) {
      setPayNow(String(knownDue));
    } else if (payType === 'partial' && payNow === String(knownDue)) {
      setPayNow('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payType, totalDue]);

  const save = async () => {
    setError('');
    const nowAmt = parseInt(payNow, 10) || 0;
    let payload;

    if (payType === 'scholarship') {
      // Scholarship waives the fee entirely — the student owes nothing.
      // No transaction ID or payment method is recorded since no money
      // actually changes hands; a zero-amount entry is logged purely for
      // an audit trail of who granted it and when.
      const dueAmt = isFirstEntry ? (parseInt(totalDue, 10) || 0) : parseInt(fee.amount_due, 10);
      const newPayments = [...payments, {
        amount: 0, method: 'scholarship', transaction_id: null,
        by: appUser?.name || user?.email || '', at: new Date().toISOString(),
        note: 'Fee waived — scholarship',
      }];
      payload = {
        academy_id: academyId, student_id: student.id, sport, batch_label: batchLabel, month: monthKey,
        status: 'paid', amount_due: dueAmt, amount: dueAmt, method: 'scholarship',
        is_scholarship: true,
        paid_date: toIso(new Date()),
        collected_by: appUser?.name || user?.email || '',
        payments: newPayments, msg_sent: fee?.msg_sent || [],
      };
    } else if (isFirstEntry) {
      const dueAmt = parseInt(totalDue, 10);
      if (!dueAmt || dueAmt < 1) { setError('Enter the total amount due'); return; }
      if (nowAmt < 0) { setError('Invalid amount'); return; }
      if (nowAmt > dueAmt) { setError(`Amount paid (₹${nowAmt}) can't be greater than the amount due (₹${dueAmt})`); return; }
      const newPayments = nowAmt > 0
        ? [...payments, { amount: nowAmt, method, transaction_id: txnId, by: appUser?.name || user?.email || '', at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) }]
        : payments;
      const newStatus = nowAmt >= dueAmt ? 'paid' : (nowAmt > 0 ? 'partial' : 'unpaid');
      payload = {
        academy_id: academyId, student_id: student.id, sport, batch_label: batchLabel, month: monthKey,
        status: newStatus, amount_due: dueAmt, amount: nowAmt,
        method: nowAmt > 0 ? method : null,
        is_scholarship: false,
        paid_date: newStatus === 'paid' ? toIso(new Date()) : null,
        collected_by: appUser?.name || user?.email || '',
        payments: newPayments, msg_sent: fee?.msg_sent || [],
      };
    } else {
      if (!nowAmt || nowAmt < 1) { setError('Enter the amount being paid now'); return; }
      const dueAmt = parseInt(fee.amount_due, 10);
      if (nowAmt > remaining) { setError(`Amount paid (₹${nowAmt}) can't be greater than the remaining balance (₹${remaining})`); return; }
      const newPaid = paidSoFar + nowAmt;
      const newPayments = [...payments, { amount: nowAmt, method, transaction_id: txnId, by: appUser?.name || user?.email || '', at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) }];
      const newStatus = newPaid >= dueAmt ? 'paid' : 'partial';
      payload = {
        academy_id: academyId, student_id: student.id, sport, batch_label: batchLabel, month: monthKey,
        status: newStatus, amount_due: dueAmt, amount: newPaid, method,
        is_scholarship: false,
        paid_date: newStatus === 'paid' ? toIso(new Date()) : (fee.paid_date || null),
        collected_by: appUser?.name || user?.email || '',
        payments: newPayments, msg_sent: fee.msg_sent || [],
      };
    }

    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('fees')
        .upsert(payload, { onConflict: 'student_id,sport,batch_label,month' })
        .select()
        .single();
      if (err) throw err;
      logActivity({
        academyId, actorId: appUser?.id, actorName: appUser?.name || user?.email,
        message: payload.status === 'paid'
          ? `Marked ${sport}${batchLabel ? ' (' + batchLabel + ')' : ''} fee fully paid for ${student.name} (${monthLabel}, ₹${payload.amount})`
          : `Recorded ₹${nowAmt} payment for ${student.name} — ${sport}${batchLabel ? ' (' + batchLabel + ')' : ''} (${monthLabel}), ₹${payload.amount}/₹${payload.amount_due} so far`,
      });
      onSaved(data);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const resetToUnpaid = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        academy_id: academyId, student_id: student.id, sport, batch_label: batchLabel, month: monthKey,
        status: 'unpaid', amount_due: fee?.amount_due || null, amount: null, method: null,
        is_scholarship: false,
        paid_date: null, collected_by: appUser?.name || user?.email || '',
        payments: [], msg_sent: fee?.msg_sent || [],
      };
      const { data, error: err } = await supabase
        .from('fees')
        .upsert(payload, { onConflict: 'student_id,sport,batch_label,month' })
        .select()
        .single();
      if (err) throw err;
      logActivity({
        academyId, actorId: appUser?.id, actorName: appUser?.name || user?.email,
        message: `Reset ${sport}${batchLabel ? ' (' + batchLabel + ')' : ''} fee to unpaid for ${student.name} (${monthLabel})`,
      });
      onSaved(data);
    } catch (err) {
      setError(err.message || 'Failed to reset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title">
          <span>💰 {student.name}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
          {monthLabel} · {sport}{batchLabel ? ` · ${batchLabel}` : ''}
        </div>

        {!isFirstEntry && (
          <div style={{ background: 'var(--card2)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--gray)' }}>Total Due</span><span>₹{due}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--gray)' }}>Paid So Far</span><span>₹{paidSoFar}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Remaining</span><span style={{ color: remaining > 0 ? 'var(--red)' : 'var(--green)' }}>₹{remaining}</span>
            </div>
            {lastPayment && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', color: 'var(--gray)' }}>
                Last payment: ₹{lastPayment.amount} · {lastPayment.method} · {lastPayment.by}
                {lastPayment.at && <> · {new Date(lastPayment.at).toLocaleDateString()}</>}
                {lastPayment.transaction_id && <div style={{ marginTop: 2 }}>{lastPayment.transaction_id}</div>}
                {lastPayment.note && <div style={{ marginTop: 2, fontStyle: 'italic' }}>📝 {lastPayment.note}</div>}
              </div>
            )}
          </div>
        )}

        {locked ? (
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
            🔒 This fee is fully paid. Only an admin can reopen it.
          </div>
        ) : (
          <>
            {isFirstEntry && (
              <FieldRow
                label="Total Amount Due ₹"
                hint={batchDefaultFee != null ? `Batch default: ₹${batchDefaultFee.toLocaleString('en-IN')}` : null}
              >
                <input type="number" min="1" className="form-input" style={{ textAlign: 'right' }} value={totalDue} onChange={e => setTotalDue(e.target.value)} placeholder="e.g. 300" />
              </FieldRow>
            )}

            <div className="form-group">
                <label className="form-label">Payment Type</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: payType === 'full' ? 'var(--accent2)' : 'var(--card2)', color: payType === 'full' ? '#fff' : 'var(--gray)' }}
                    onClick={() => setPayType('full')}
                  >💯 Full</button>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: payType === 'partial' ? 'var(--accent2)' : 'var(--card2)', color: payType === 'partial' ? '#fff' : 'var(--gray)' }}
                    onClick={() => setPayType('partial')}
                  >➗ Partial</button>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: payType === 'scholarship' ? 'var(--gold, #e0a020)' : 'var(--card2)', color: payType === 'scholarship' ? '#fff' : 'var(--gray)' }}
                    onClick={() => setPayType('scholarship')}
                  >🎓 Scholarship</button>
                </div>
              </div>

            {payType === 'scholarship' ? (
              <div style={{ background: 'rgba(230,160,20,0.12)', border: '1px solid rgba(230,160,20,0.4)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--gold, #e0a020)' }}>
                🎓 This student is on scholarship — no payment is required. This fee will be marked fully settled with ₹0 collected.
              </div>
            ) : (
              <>
                <FieldRow
                  label="Amount Paying Now ₹"
                  hint={isFirstEntry ? 'Leave blank if none yet' : `Remaining ₹${remaining}`}
                >
                  <input
                    type="number" min={isFirstEntry ? '0' : '1'} className="form-input" style={{ textAlign: 'right' }} value={payNow}
                    onChange={e => { setPayNow(e.target.value); setPayType('partial'); }}
                    placeholder="Amount"
                    readOnly={payType === 'full'}
                  />
                </FieldRow>

                {(isFirstEntry ? parseInt(payNow, 10) > 0 : true) && (
                  <>
                    <FieldRow label="Payment Method">
                      <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="bank">Bank Transfer</option>
                      </select>
                    </FieldRow>

                    <FieldRow label="Transaction ID" hint="Auto-generated" boxWidth={190}>
                      <input type="text" className="form-input" value={txnId} readOnly style={{ opacity: 0.75, fontSize: 12, textAlign: 'right' }} />
                    </FieldRow>

                    <div className="form-group">
                      <label className="form-label">Note (optional)</label>
                      <input
                        type="text" maxLength={100} className="form-input" value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="e.g. Paid by father, balance next week"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {fee?.collected_by && (
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>Last saved by: {fee.collected_by}</div>
        )}

        {isAdmin && status !== 'unpaid' && !confirmReset && (
          <button className="btn" style={{ width: '100%', fontSize: 11, color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)', marginBottom: 8 }} onClick={() => setConfirmReset(true)}>
            🔓 Admin: Reset to Unpaid
          </button>
        )}
        {confirmReset && (
          <div style={{ fontSize: 11, marginBottom: 8, color: 'var(--red)' }}>
            This clears all recorded payments for this entry. Are you sure?
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn" style={{ flex: 1, background: 'var(--red)', color: '#fff' }} onClick={resetToUnpaid} disabled={saving}>Confirm Reset</button>
            </div>
          </div>
        )}

        {!locked && onMultiMonth && payType !== 'scholarship' && (
          <button
            type="button"
            onClick={onMultiMonth}
            style={{ width: '100%', background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '7px 0', marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--accent2)', cursor: 'pointer' }}
          >
            📅 Paying for multiple months?
          </button>
        )}

        {!locked && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn" style={{ flex: 1, background: 'var(--card2)' }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Records ONE payment that covers several months. The person ticks the
// months, enters what was received, and the amount is allocated to the
// months in order (oldest first): each month is filled up to its own due,
// and a last month can end up partially paid. Every affected month still
// gets its own normal fee entry + payment (own transaction ID), so status,
// filters, pending warnings and exports all keep working per month.
function MultiMonthModal({ student, sport, batchLabel, months, startMonthKey, defaultFee, nextTxnSeq, onClose, onSaved }) {
  const { academyId, appUser, user } = useAuth();
  const [existing, setExisting] = useState(null); // { 'YYYY-MM': full fee row }
  const [selected, setSelected] = useState(() => new Set([startMonthKey]));
  const [perMonth, setPerMonth] = useState(defaultFee != null ? String(defaultFee) : '');
  const [total, setTotal] = useState('');
  const [totalTouched, setTotalTouched] = useState(false);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      let q = supabase.from('fees').select('*')
        .eq('academy_id', academyId).eq('student_id', student.id).eq('sport', sport).in('month', months);
      q = batchLabel ? q.eq('batch_label', batchLabel) : q.is('batch_label', null);
      const { data, error: err } = await q;
      if (err) setError(err.message);
      const map = {};
      (data || []).forEach(r => { map[r.month] = r; });
      setExisting(map);
      // No batch default? Fall back to the due already set on the start month.
      const startDue = map[startMonthKey]?.amount_due;
      if (startDue) setPerMonth(prev => prev || String(startDue));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per selected month: what's due, what's already paid, what's left.
  const plan = useMemo(() => {
    if (!existing) return [];
    const per = parseInt(perMonth, 10) || 0;
    return months.filter(mk => selected.has(mk)).map(mk => {
      const ex = existing[mk];
      const due = ex?.amount_due ? parseInt(ex.amount_due, 10) : per;
      const paid = ex?.amount ? parseInt(ex.amount, 10) : 0;
      return { mk, ex, due, paid, rem: Math.max(due - paid, 0) };
    });
  }, [existing, months, selected, perMonth]);

  const sumRemaining = plan.reduce((a, p) => a + p.rem, 0);
  useEffect(() => {
    if (!totalTouched) setTotal(sumRemaining > 0 ? String(sumRemaining) : '');
  }, [sumRemaining, totalTouched]);

  // Oldest month first: fill each up to its remaining balance.
  const { alloc, leftover } = useMemo(() => {
    let left = parseInt(total, 10) || 0;
    const rows = plan.map(p => {
      const pay = Math.min(left, p.rem);
      left -= pay;
      return { ...p, pay };
    });
    return { alloc: rows, leftover: left };
  }, [plan, total]);

  const toggle = (mk) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(mk) ? next.delete(mk) : next.add(mk);
      return next;
    });
  };

  const save = async () => {
    setError('');
    if (plan.length === 0) { setError('Select at least one month'); return; }
    if (plan.some(p => p.due <= 0)) { setError('Enter the amount per month'); return; }
    const totalAmt = parseInt(total, 10) || 0;
    if (totalAmt < 1) { setError('Enter the amount received'); return; }
    if (leftover > 0) { setError(`Amount received is ₹${leftover} more than the selected months need`); return; }

    const paying = alloc.filter(a => a.pay > 0);
    const by = appUser?.name || user?.email || '';
    const nowIso = new Date().toISOString();
    const rows = paying.map((a, i) => {
      const newPaid = a.paid + a.pay;
      const status = newPaid >= a.due ? 'paid' : 'partial';
      return {
        academy_id: academyId, student_id: student.id, sport, batch_label: batchLabel, month: a.mk,
        status, amount_due: a.due, amount: newPaid, method,
        is_scholarship: false,
        paid_date: status === 'paid' ? toIso(new Date()) : (a.ex?.paid_date || null),
        collected_by: by,
        payments: [...(a.ex?.payments || []), {
          amount: a.pay, method, transaction_id: genTxnId(academyId, student.roll_no, nextTxnSeq + i),
          by, at: nowIso,
          note: note.trim() || `Part of a ${paying.length}-month payment`,
        }],
        msg_sent: a.ex?.msg_sent || [],
      };
    });

    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('fees')
        .upsert(rows, { onConflict: 'student_id,sport,batch_label,month' })
        .select();
      if (err) throw err;
      logActivity({
        academyId, actorId: appUser?.id, actorName: appUser?.name || user?.email,
        message: `Recorded ₹${totalAmt} multi-month payment for ${student.name} — ${sport}${batchLabel ? ' (' + batchLabel + ')' : ''}: ${paying.map(a => monthKeyLabel(a.mk)).join(', ')}`,
      });
      onSaved(data || []);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-title">
          <span>📅 {student.name}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
          {sport}{batchLabel ? ` · ${batchLabel}` : ''} · pay several months at once
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {!existing && <div style={{ fontSize: 12, color: 'var(--gray)', padding: '10px 0' }}>Loading…</div>}

        {existing && (
          <>
            <div className="form-label" style={{ marginBottom: 4 }}>Months to pay</div>
            <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '2px 10px', marginBottom: 12 }}>
              {months.map(mk => {
                const ex = existing[mk];
                const due = ex?.amount_due ? parseInt(ex.amount_due, 10) : null;
                const paid = ex?.amount ? parseInt(ex.amount, 10) : 0;
                return (
                  <label key={mk} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(mk)} onChange={() => toggle(mk)} />
                    <span style={{ flex: 1, fontWeight: 600 }}>{monthKeyLabel(mk)}</span>
                    <span style={{ fontSize: 11, color: 'var(--gray)' }}>
                      {due != null ? (paid > 0 ? `₹${paid} of ₹${due} paid` : `₹${due} due`) : 'no entry yet'}
                    </span>
                  </label>
                );
              })}
            </div>

            <FieldRow label="Amount per month ₹" hint="For months with no amount set yet">
              <input type="number" min="1" className="form-input" style={{ textAlign: 'right' }} value={perMonth} onChange={e => setPerMonth(e.target.value)} placeholder="e.g. 500" />
            </FieldRow>

            <FieldRow label="Total received ₹" hint={sumRemaining > 0 ? `Selected months need ₹${sumRemaining}` : null}>
              <input
                type="number" min="1" className="form-input" style={{ textAlign: 'right' }} value={total}
                onChange={e => { setTotal(e.target.value); setTotalTouched(true); }}
                placeholder="Amount"
              />
            </FieldRow>

            {alloc.length > 0 && (parseInt(total, 10) || 0) > 0 && (
              <div style={{ background: 'var(--card2)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12 }}>
                <div style={{ color: 'var(--gray)', marginBottom: 4 }}>How it will be applied</div>
                {alloc.map(a => {
                  const newPaid = a.paid + a.pay;
                  const st = a.pay === 0 ? 'unchanged' : (newPaid >= a.due ? 'Paid' : `Partial · ₹${newPaid} of ₹${a.due}`);
                  return (
                    <div key={a.mk} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{monthKeyLabel(a.mk)}</span>
                      <span style={{ color: a.pay === 0 ? 'var(--gray)' : (st === 'Paid' ? 'var(--green)' : '#e0a020') }}>
                        {a.pay > 0 ? `₹${a.pay} → ` : ''}{st}
                      </span>
                    </div>
                  );
                })}
                {leftover > 0 && <div style={{ color: 'var(--red)', marginTop: 4 }}>₹{leftover} more than these months need — select more months.</div>}
              </div>
            )}

            <FieldRow label="Payment Method">
              <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
              </select>
            </FieldRow>

            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <input type="text" maxLength={100} className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Paid 3 months in advance" />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn" style={{ flex: 1, background: 'var(--card2)' }} onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function FeesTab() {
  const { visibleStudents, visibleStudentsForHistory, visibleSports, visibleBatches, academy } = useAcademyData();
  const { isAdmin, academyId, appUser, user, canExportFees, canImportFees, canViewFees, canViewContactStudents } = useAuth();
  const { hasFeature, cheapestPlanWithFeature } = usePlan();
  // Matches the pattern AttendanceTab uses for `markedBy` — real name lives
  // on appUser (the app_users row), not the raw Supabase auth `user`.
  const collectedBy = appUser?.name || user?.email || (isAdmin ? 'Admin' : 'Staff');

  const today = new Date();
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'year'
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [year, setYear] = useState(today.getFullYear());
  const [sportFilter, setSportFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('outstanding'); // 'all' | 'outstanding' | 'paid' | 'partial' | 'unpaid'
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [popup, setPopup] = useState(null); // 'month' | 'year' | 'sport' | 'batch' | 'status' | null

  const [fees, setFees] = useState([]);
  const [txnCounts, setTxnCounts] = useState({}); // student_id -> total payment count, ALL months (needed for sequential txn IDs)
  const [allFees, setAllFees] = useState([]); // lightweight all-months fee rows, used only to find past pending months
  const [pendingPopup, setPendingPopup] = useState(null); // { student, sport, batchLabel, items }
  const [multiModal, setMultiModal] = useState(null); // { student, sport, batchLabel, months, startMonthKey, defaultFee }
  const [attendance, setAttendance] = useState([]); // {student_id, status, date}
  const [loading, setLoading] = useState(false);

  const [sendModal, setSendModal] = useState(null);
  const [entryModal, setEntryModal] = useState(null); // { student, monthKey, monthLabel, sport, fee }
  const [showImport, setShowImport] = useState(false);

  // A row's `month` key is fine to compare lexically ('2026-01' <= '2026-08')
  // since it's always YYYY-MM. Used both for the scoped fetch below and to
  // decide whether an incoming realtime row belongs on screen right now.
  const monthKeyFor = (y, m) => `${y}-${pad(m)}`;
  const rowInScope = (row) => {
    if (!row?.month) return false;
    return viewMode === 'year' ? row.month.slice(0, 4) === String(year) : row.month === monthKeyFor(year, month);
  };

  // Fee rows for display are scoped to whatever period is on screen (current
  // month, or the whole selected year) — same pattern AttendanceTab already
  // uses for the `attendance` table — instead of pulling every fee row the
  // academy has ever recorded.
  const loadFees = async () => {
    if (!academyId) return;
    let q = supabase.from('fees').select('*').eq('academy_id', academyId);
    q = viewMode === 'year'
      ? q.gte('month', monthKeyFor(year, 1)).lte('month', monthKeyFor(year, 12))
      : q.eq('month', monthKeyFor(year, month));
    const { data } = await q;
    setFees(data || []);
  };
  useEffect(() => { loadFees(); }, [academyId, viewMode, month, year]);

  // Transaction IDs are numbered sequentially per student across their
  // ENTIRE history (see genTxnId), not just the visible period, so this
  // needs a separate all-time query. Kept cheap by selecting only the two
  // columns actually needed (not the full row — skips amount, method,
  // msg_sent, collected_by, etc.) so it stays far lighter than the old
  // `select('*')` even though it still touches every fee row.
  const loadTxnCounts = async () => {
    if (!academyId) return;
    const { data } = await supabase.from('fees')
      .select('student_id, payments, sport, batch_label, month, status, amount_due, amount, is_scholarship')
      .eq('academy_id', academyId);
    setAllFees(data || []);
    const counts = {};
    (data || []).forEach(f => {
      const n = (f.payments || []).length;
      if (!n) return;
      counts[f.student_id] = (counts[f.student_id] || 0) + n;
    });
    setTxnCounts(counts);
  };
  useEffect(() => { loadTxnCounts(); }, [academyId]);

  // ---- Realtime sync ----
  // `fees` isn't loaded through AcademyDataContext — it's fetched here,
  // scoped to the visible period, and kept in sync locally after each save.
  // A changed row only gets merged into `fees` if it belongs to the period
  // currently on screen; any change anywhere (any month) still triggers a
  // debounced refresh of `txnCounts`, since that has to stay accurate
  // academy-wide regardless of which month you're looking at.
  const txnCountsDebounceRef = useRef(null);
  const scheduleTxnCountsReload = () => {
    clearTimeout(txnCountsDebounceRef.current);
    txnCountsDebounceRef.current = setTimeout(loadTxnCounts, 400);
  };

  useEffect(() => {
    if (!academyId) return;

    const channel = supabase
      .channel(`fees-${academyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fees', filter: `academy_id=eq.${academyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old;
            if (!oldRow) return;
            if (rowInScope(oldRow)) setFees(prev => prev.filter(f => f.id !== oldRow.id));
          } else {
            const row = payload.new;
            if (!row) return;
            if (rowInScope(row)) {
              setFees(prev => {
                const idx = prev.findIndex(f => f.id === row.id);
                if (idx === -1) return [...prev, row];
                const next = prev.slice();
                next[idx] = row;
                return next;
              });
            }
          }
          scheduleTxnCountsReload();
        })
      .subscribe();

    return () => { clearTimeout(txnCountsDebounceRef.current); supabase.removeChannel(channel); };
  }, [academyId, viewMode, month, year]);

  // Attendance is fetched fresh for whichever period is being viewed (month or full year),
  // since that determines who's "eligible" to owe fees. Paginated via
  // fetchAllRows so a busy academy's Year view (or even a busy Month) can't
  // silently truncate at Supabase's 1000-row-per-request default.
  useEffect(() => {
    (async () => {
      if (!academyId) return;
      setLoading(true);
      try {
        const from = viewMode === 'year' ? `${year}-01-01` : `${year}-${pad(month)}-01`;
        const to = viewMode === 'year' ? `${year}-12-31` : `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
        const buildQuery = () => supabase.from('attendance').select('id,student_id,status,date,sport,batch')
          .eq('academy_id', academyId).gte('date', from).lte('date', to);
        const data = await fetchAllRows(buildQuery);
        setAttendance(data);
      } catch (err) {
        console.error('Attendance fetch failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [academyId, viewMode, month, year]);

  // ---- Realtime sync for attendance ----
  // `attendance` isn't loaded through AcademyDataContext either — like
  // `fees` above, it's fetched here scoped to the visible period. Without
  // this subscription, marking a student Present/Absent in AttendanceTab
  // only showed up here after manually flipping the month away and back
  // (which happens to re-trigger the fetch effect above) — not live. This
  // mirrors the `fees` channel: merge a changed row in only if its date
  // falls within the period currently on screen.
  const attendanceInScope = (row) => {
    if (!row?.date) return false;
    const from = viewMode === 'year' ? `${year}-01-01` : `${year}-${pad(month)}-01`;
    const to = viewMode === 'year' ? `${year}-12-31` : `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    return row.date >= from && row.date <= to;
  };

  useEffect(() => {
    if (!academyId) return;

    const channel = supabase
      .channel(`fees-attendance-${academyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `academy_id=eq.${academyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old;
            if (!oldRow) return;
            setAttendance(prev => prev.filter(r => r.id !== oldRow.id));
          } else {
            const row = payload.new;
            if (!row || !attendanceInScope(row)) return;
            setAttendance(prev => {
              const idx = prev.findIndex(r => r.id === row.id);
              if (idx === -1) return [...prev, row];
              const next = prev.slice();
              next[idx] = row;
              return next;
            });
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [academyId, viewMode, month, year]);

  const attendanceByStudentByMonth = useMemo(() => {
    // { 'YYYY-MM': { studentId: [rows] } }
    const out = {};
    attendance.forEach(r => {
      const mk = r.date.slice(0, 7);
      if (!out[mk]) out[mk] = {};
      if (!out[mk][r.student_id]) out[mk][r.student_id] = [];
      out[mk][r.student_id].push(r);
    });
    return out;
  }, [attendance]);

  // A day counts as a "class day" for a given sport+batch, in a given month,
  // if ANYONE was marked Present that day — matches AttendanceTab's own
  // classDaySets definition (an Absent-only day, e.g. a holiday nobody
  // attended, doesn't count). Keyed by monthKey::sport::batch so the export
  // can look up the right denominator per fee row.
  const classDaysByPeriod = useMemo(() => {
    const map = {};
    attendance.forEach(r => {
      if (r.status !== 'P') return;
      const mk = r.date.slice(0, 7);
      const k = `${mk}::${norm(r.sport)}::${norm(r.batch)}`;
      if (!map[k]) map[k] = new Set();
      map[k].add(r.date);
    });
    return map;
  }, [attendance]);

  const feeMap = useMemo(() => {
    const m = {};
    fees.forEach(f => { m[`${f.student_id}|${norm(f.sport)}|${norm(f.batch_label)}|${f.month}`] = f; });
    return m;
  }, [fees]);

  const batchesForSport = useMemo(() =>
    visibleBatches.filter(b => !sportFilter || b.sport === sportFilter),
    [visibleBatches, sportFilter]);

  // An enrollment counts for a given month if it overlapped that month at
  // all — mirrors AttendanceTab's enrollmentOverlapsPeriod — so a student
  // who's since switched sport/batch still gets a fee row for the OLD
  // sport/batch for whichever months they were actually enrolled in it,
  // instead of that history disappearing the moment a newer enrollment
  // supersedes it.
  const enrollmentOverlapsMonth = (en, y, m) => {
    const periodStart = `${y}-${pad(m)}-01`;
    const periodEnd = toIso(new Date(y, m, 0));
    return (!en.join_date || en.join_date <= periodEnd) && (!en.left_date || en.left_date >= periodStart);
  };

  // Builds one student's set of sport+batch enrollment rows relevant to a
  // given month, from their full enrollment HISTORY (not just the
  // currently-active enrollment), then applies sport/batch/search filters.
  // Deduped per sport+batch key so a student who left and rejoined the same
  // sport+batch within one month doesn't produce two identical rows for it.
  const enrollmentRowsForMonth = useMemo(() => {
    return (y, m) => {
      const rows = [];
      visibleStudentsForHistory.forEach(s => {
        const history = (s.enrollmentHistory && s.enrollmentHistory.length > 0)
          ? s.enrollmentHistory
          : [{ sport: s.sport, batchLabel: s.batchLabel, join_date: s.join_date, left_date: null }];
        const seen = new Set();
        history.forEach(en => {
          if (!en.sport) return;
          if (!enrollmentOverlapsMonth(en, y, m)) return;
          if (sportFilter && norm(en.sport) !== norm(sportFilter)) return;
          if (batchFilter && norm(en.batchLabel) !== norm(batchFilter)) return;
          const key = keyFor(s.id, en.sport, en.batchLabel);
          if (seen.has(key)) return;
          seen.add(key);
          rows.push({ student: s, sport: en.sport, batchLabel: en.batchLabel, key });
        });
      });
      if (!search.trim()) return rows;
      const q = search.trim().toLowerCase();
      return rows.filter(r => (r.student.name || '').toLowerCase().includes(q) || (r.student.roll_no || '').toLowerCase().includes(q));
    };
  }, [visibleStudentsForHistory, sportFilter, batchFilter, search]);

  // Builds the display rows for one month. A student owes fees for every
  // enrollment (sport + batch) that overlaps the month — i.e. from the
  // month they were enrolled onward — regardless of attendance. Each row is
  // paired with its fee entry (or null if not yet recorded).
  function buildMonthRows(y, m) {
    const monthKey = `${y}-${pad(m)}`;
    const toRow = (r) => {
      const fee = feeMap[`${r.student.id}|${norm(r.sport)}|${norm(r.batchLabel)}|${monthKey}`] || null;
      const st = feeStatus(fee);
      return { student: r.student, sport: r.sport, batchLabel: r.batchLabel, fee, monthKey, status: st, paid: st === 'paid', key: r.key };
    };
    // Dropped (banned) students stop owing fees after the month they were
    // dropped (banned_on). If no drop date is stored, they're hidden for
    // every month. In both cases a month that already has a fee record
    // stays visible, so past payment history is never lost.
    const isDroppedFor = (s) => {
      if (!s.banned) return false;
      return s.banned_on ? monthKey > String(s.banned_on).slice(0, 7) : true;
    };
    const rows = enrollmentRowsForMonth(y, m)
      .map(toRow)
      .filter(r => !isDroppedFor(r.student) || r.fee);
    return { monthKey, rows };
  }

  const periods = useMemo(() => {
    if (viewMode === 'month') return [buildMonthRows(year, month)];
    return Array.from({ length: 12 }, (_, i) => buildMonthRows(year, i + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, year, month, enrollmentRowsForMonth, feeMap]);

  const allRows = useMemo(() => periods.flatMap(p => p.rows), [periods]);
  const paidRows = useMemo(() => allRows.filter(r => r.status === 'paid'), [allRows]);
  const partialRows = useMemo(() => allRows.filter(r => r.status === 'partial'), [allRows]);
  const unpaidRows = useMemo(() => allRows.filter(r => r.status === 'unpaid'), [allRows]);

  const outstandingRows = useMemo(() => allRows.filter(r => r.status === 'unpaid' || r.status === 'partial'), [allRows]);

  const activeRows = statusFilter === 'all' ? allRows
    : statusFilter === 'outstanding' ? outstandingRows
    : statusFilter === 'paid' ? paidRows
    : statusFilter === 'partial' ? partialRows
    : unpaidRows;

  // Sum of amounts actually collected across the rows currently shown —
  // admin-only figure surfaced next to the status chip's count.
  const activeAmountTotal = useMemo(
    () => activeRows.reduce((sum, r) => sum + (r.fee?.amount ? parseInt(r.fee.amount, 10) : 0), 0),
    [activeRows]
  );

  const monthLabelFor = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  };

  const openReminder = (row) => {
    const monthLabel = monthLabelFor(row.monthKey);
    const text = buildMsg(academy?.msg_template || DEFAULT_MSG, { name: row.student.name, month: monthLabel, academy: academy?.name });
    setSendModal({ row, student: row.student, month: monthLabel, kind: 'reminder', text });
  };
  const openThankYou = (row) => {
    const monthLabel = monthLabelFor(row.monthKey);
    const text = buildMsg(academy?.thank_template || DEFAULT_THANK, { name: row.student.name, month: monthLabel, academy: academy?.name, amount: row.fee?.amount, method: row.fee?.method || 'Cash' });
    setSendModal({ row, student: row.student, month: monthLabel, kind: 'paid', text });
  };
  // ---- Pending fees from earlier months ----
  // For one fee row (student + sport + batch, viewed in some month), finds
  // every EARLIER month since that enrollment began that isn't fully paid —
  // either unpaid, partially paid, or with no fee entry at all. Months
  // after the enrollment ended, or after a dropped student's banned_on
  // month, aren't counted. Scholarship months count as settled.
  const pendingLookup = useMemo(() => {
    const m = new Map();
    allFees.forEach(f => m.set(`${f.student_id}|${norm(f.sport)}|${norm(f.batch_label)}|${f.month}`, f));
    return m;
  }, [allFees]);

  const getPending = (row) => {
    const s = row.student;
    if (s.banned && !s.banned_on) return [];
    const hist = (s.enrollmentHistory || []).filter(en => norm(en.sport) === norm(row.sport) && norm(en.batchLabel) === norm(row.batchLabel));
    const joins = hist.map(en => en.join_date).filter(Boolean).sort();
    const start = String(joins[0] || s.join_date || '').slice(0, 7);
    if (!start) return [];

    const stepMonth = stepMonthKey;
    const currentMonthKey = toIso(new Date()).slice(0, 7);
    let end = stepMonth(row.monthKey, -1);
    if (end > currentMonthKey) end = currentMonthKey;
    if (hist.length > 0 && hist.every(en => en.left_date)) {
      const lastLeft = hist.map(en => String(en.left_date).slice(0, 7)).sort().pop();
      if (lastLeft < end) end = lastLeft;
    }
    if (s.banned && s.banned_on) {
      const dropMonth = String(s.banned_on).slice(0, 7);
      if (dropMonth < end) end = dropMonth;
    }

    const items = [];
    for (let mk = start; mk <= end; mk = stepMonth(mk, 1)) {
      const f = pendingLookup.get(`${s.id}|${norm(row.sport)}|${norm(row.batchLabel)}|${mk}`);
      const st = feeStatus(f);
      if (st === 'paid') continue;
      items.push({
        monthKey: mk, status: st,
        due: f?.amount_due ? parseInt(f.amount_due, 10) : null,
        paid: f?.amount ? parseInt(f.amount, 10) : 0,
      });
    }
    return items;
  };

  // Tapping a pending month in the warning popup opens the normal Pay
  // popup for THAT month. The lightweight allFees rows lack a few columns
  // (id, method, msg_sent...), so the full row is fetched first — it saves
  // through the same FeeEntryModal / upsert path as any other payment.
  const openPendingMonth = async (item) => {
    if (!pendingPopup) return;
    const { student, sport, batchLabel } = pendingPopup;
    let q = supabase.from('fees').select('*')
      .eq('academy_id', academyId).eq('student_id', student.id)
      .eq('sport', sport).eq('month', item.monthKey);
    q = batchLabel ? q.eq('batch_label', batchLabel) : q.is('batch_label', null);
    const { data } = await q.maybeSingle();
    setPendingPopup(null);
    setEntryModal({ student, monthKey: item.monthKey, monthLabel: monthLabelFor(item.monthKey), sport, batchLabel, fee: data || null });
  };

  const openEntry = (row) => {
    setEntryModal({ student: row.student, monthKey: row.monthKey, monthLabel: monthLabelFor(row.monthKey), sport: row.sport, batchLabel: row.batchLabel, fee: row.fee });
  };

  // Logs a sent reminder/thank-you against the fee row (creating a bare unpaid
  // row if one doesn't exist yet), so the Remind button can show a running count.
  const recordMsgSent = async (row, kind, type) => {
    if (!row) return;
    const existing = row.fee;
    const entry = { kind, type, by: appUser?.name || user?.email || '', at: new Date().toISOString() };
    const msgSent = [...(existing?.msg_sent || []), entry];
    const payload = {
      academy_id: academyId,
      student_id: row.student.id,
      sport: row.sport,
      batch_label: row.batchLabel,
      month: row.monthKey,
      status: existing?.status || 'unpaid',
      amount_due: existing?.amount_due ?? null,
      amount: existing?.amount ?? null,
      method: existing?.method ?? null,
      is_scholarship: existing?.is_scholarship ?? false,
      paid_date: existing?.paid_date ?? null,
      collected_by: existing?.collected_by ?? null,
      payments: existing?.payments || [],
      msg_sent: msgSent,
    };
    const { data, error } = await supabase
      .from('fees')
      .upsert(payload, { onConflict: 'student_id,sport,batch_label,month' })
      .select()
      .single();
    if (!error && data) {
      setFees(prev => {
        const idx = prev.findIndex(f => f.id === data.id);
        if (idx === -1) return [...prev, data];
        const next = [...prev];
        next[idx] = data;
        return next;
      });
      logActivity({
        academyId, actorId: appUser?.id, actorName: appUser?.name || user?.email,
        message: `Sent ${kind === 'thank' ? 'payment thank-you' : 'fee reminder'} (${type}) to ${row.student.name} — ${row.sport}${row.batchLabel ? ' (' + row.batchLabel + ')' : ''}`,
      });
    }
  };

  const goPrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); }
  };
  const goNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); }
  };

  // Column order: Roll, Student, Contact (only if the viewer is allowed to
  // see contact numbers), Sport, Batch, Month, Days Present, Class Days,
  // Attendance %, Status, Amount Due, Amount Paid. Kept as an explicit array
  // (rather than relying on object key order) so PDF's header row and each
  // row's values can never drift apart, even as the Contact column is
  // conditionally present or absent.
  const exportColumns = [
    'Roll', 'Student',
    ...(canViewContactStudents ? ['Contact'] : []),
    'Sport', 'Batch', 'Month',
    'Days Present', 'Class Days', 'Attendance %',
    'Status', 'Amount Due', 'Amount Paid',
  ];
  const exportRows = activeRows.map(r => {
    const classDays = classDaysByPeriod[`${r.monthKey}::${norm(r.sport)}::${norm(r.batchLabel)}`]?.size || 0;
    // "Days Present" for this specific sport+batch+month — reuses the same
    // grouped attendance data the on-screen eligibility check already relies
    // on, filtered down to this row's own sport/batch (a student in two
    // enrollments only counts attendance against the matching one).
    const attRows = attendanceByStudentByMonth[r.monthKey]?.[r.student.id] || [];
    const daysPresent = attRows.filter(a => a.status === 'P' && norm(a.sport) === norm(r.sport) && norm(a.batch) === norm(r.batchLabel)).length;
    const attendancePct = classDays ? Math.round((daysPresent / classDays) * 100) : 0;
    const row = {
      Roll: r.student.roll_no,
      Student: r.student.name,
      ...(canViewContactStudents ? { Contact: r.student.contact || '' } : {}),
      Sport: r.sport,
      Batch: r.batchLabel,
      Month: monthLabelFor(r.monthKey),
      'Days Present': daysPresent,
      'Class Days': classDays,
      'Attendance %': `${attendancePct}%`,
      Status: r.fee?.is_scholarship ? 'Scholarship' : r.status === 'paid' ? 'Paid' : r.status === 'partial' ? 'Partially Paid' : 'Unpaid',
      'Amount Due': r.fee?.amount_due || 0,
      'Amount Paid': r.fee?.amount || 0,
    };
    return row;
  });

  // Per-tab access gate — after all hooks above, before any early return,
  // so Rules of Hooks holds. Staff without the Fees tab granted (Staff
  // Users) land here instead of fee data.
  if (!canViewFees) {
    return (
      <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Fees</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>💰 Fees</div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canExportFees && hasFeature('has_reports') && (
            <>
              <button className="btn btn-gold btn-sm" style={{ padding: '5px 9px', fontSize: 11 }} onClick={() => exportGenericPdf('Fees Report', exportColumns, exportRows.map(row => exportColumns.map(c => row[c])), 'fees.pdf')}>PDF</button>
              <button className="btn btn-success btn-sm" style={{ padding: '5px 9px', fontSize: 11 }} onClick={() => exportGenericXlsx(exportRows, 'fees.xlsx', 'Fees')}>XL</button>
            </>
          )}
          {canExportFees && !hasFeature('has_reports') && (() => {
            const target = cheapestPlanWithFeature('has_reports');
            return (
              <button
                className="btn btn-outline btn-sm"
                style={{ padding: '5px 9px', fontSize: 11, opacity: 0.5, cursor: 'not-allowed' }}
                disabled
                title={target ? `Upgrade to ${target.name} to unlock exports` : 'Not available on your plan'}
              >
                PDF/XL
              </button>
            );
          })()}
          {canImportFees && hasFeature('has_bulk_import') && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowImport(true)}>⬆️ Import</button>
          )}
          {canImportFees && !hasFeature('has_bulk_import') && (() => {
            const target = cheapestPlanWithFeature('has_bulk_import');
            return (
              <button
                className="btn btn-outline btn-sm"
                style={{ opacity: 0.5, cursor: 'not-allowed' }}
                disabled
                title={target ? `Upgrade to ${target.name} to unlock bulk import` : 'Not available on your plan'}
              >
                ⬆️ Import
              </button>
            );
          })()}
        </div>
      </div>

      {/* Filters dropdown: view mode, month, year, sport, batch */}
      <div className="card" style={{ padding: 0, marginBottom: 8, overflow: 'hidden' }}>
        <button
          onClick={() => setFiltersOpen(v => !v)}
          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
        >
          <span>Filters — {viewMode === 'year' ? `Full Year ${year}` : `${MONTHS[month - 1]} ${year}`}{sportFilter ? ` · ${sportFilter}` : ''}{batchFilter ? ` · ${batchFilter}` : ''}</span>
          <span>{filtersOpen ? '▲' : '▼'}</span>
        </button>

        {filtersOpen && (
          <div style={{ padding: '0 12px 12px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: viewMode === 'month' ? 'var(--accent2)' : 'var(--card2)', color: viewMode === 'month' ? '#fff' : 'var(--gray)' }}
                onClick={() => setViewMode('month')}
              >📅 Month</button>
              <button
                style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: viewMode === 'year' ? 'var(--accent2)' : 'var(--card2)', color: viewMode === 'year' ? '#fff' : 'var(--gray)' }}
                onClick={() => setViewMode('year')}
              >🗓️ Full Year</button>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              {viewMode === 'month' && (
                <>
                  <button
                    className="btn btn-xs"
                    style={{ padding: '6px 10px' }}
                    onClick={goPrevMonth}
                  >◀</button>
                  <button className="btn btn-outline btn-sm" style={{ flex: 1, fontSize: 12, padding: '7px 9px' }} onClick={() => setPopup('month')}>
                    {MONTHS[month - 1]}
                  </button>
                  <button
                    className="btn btn-xs"
                    style={{ padding: '6px 10px' }}
                    onClick={goNextMonth}
                  >▶</button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              <button className="btn btn-xs" style={{ padding: '6px 10px' }} onClick={() => setYear(y => y - 1)}>◀</button>
              <button className="btn btn-outline btn-sm" style={{ flex: 1, fontSize: 12, padding: '7px 9px' }} onClick={() => setPopup('year')}>
                {year}
              </button>
              <button className="btn btn-xs" style={{ padding: '6px 10px' }} onClick={() => setYear(y => y + 1)}>▶</button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm" style={{ flex: 1, fontSize: 12, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setPopup('sport')}>
                {sportFilter || 'All Sports'}
              </button>
              <button className="btn btn-outline btn-sm" style={{ flex: 1, fontSize: 12, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setPopup('batch')}>
                {batchFilter || 'All Batches'}
              </button>
            </div>
          </div>
        )}
      </div>

      {popup === 'month' && (
        <FilterPopup title="Select Month" onClose={() => setPopup(null)}>
          {MONTHS.map((mLabel, i) => (
            <RadioRow key={mLabel} name="monthsel" checked={month === i + 1} onChange={() => { setMonth(i + 1); setPopup(null); }} label={mLabel} />
          ))}
        </FilterPopup>
      )}

      {popup === 'year' && (
        <FilterPopup title="Select Year" onClose={() => setPopup(null)}>
          {Array.from({ length: 6 }, (_, i) => today.getFullYear() - 3 + i).map(y => (
            <RadioRow key={y} name="yearsel" checked={year === y} onChange={() => { setYear(y); setPopup(null); }} label={String(y)} />
          ))}
        </FilterPopup>
      )}

      {popup === 'sport' && (
        <FilterPopup title="Select Sport" onClose={() => setPopup(null)}>
          <RadioRow name="sportsel" checked={!sportFilter} onChange={() => { setSportFilter(''); setBatchFilter(''); setPopup(null); }} label="All Sports" />
          {visibleSports.map(s => (
            <RadioRow key={s.id} name="sportsel" checked={sportFilter === s.name} onChange={() => { setSportFilter(s.name); setBatchFilter(''); setPopup(null); }} label={s.name} />
          ))}
        </FilterPopup>
      )}

      {popup === 'batch' && (
        <FilterPopup title="Select Batch" onClose={() => setPopup(null)}>
          <RadioRow name="batchsel" checked={!batchFilter} onChange={() => { setBatchFilter(''); setPopup(null); }} label="All Batches" />
          {batchesForSport.map(b => (
            <RadioRow
              key={b.id} name="batchsel" checked={batchFilter === b.batchLabel}
              onChange={() => { setSportFilter(b.sport); setBatchFilter(b.batchLabel); setPopup(null); }}
              label={sportFilter ? b.batchLabel : `${b.batchLabel} · ${b.sport}`}
            />
          ))}
        </FilterPopup>
      )}

      {popup === 'status' && (
        <FilterPopup title="Filter by Status" onClose={() => setPopup(null)}>
          {STATUS_OPTIONS.map(o => (
            <RadioRow
              key={o.v} name="statussel" checked={statusFilter === o.v}
              onChange={() => { setStatusFilter(o.v); setPopup(null); }}
              label={`${o.l} (${
                o.v === 'outstanding' ? outstandingRows.length
                : o.v === 'paid' ? paidRows.length
                : o.v === 'partial' ? partialRows.length
                : o.v === 'unpaid' ? unpaidRows.length
                : allRows.length
              })`}
            />
          ))}
        </FilterPopup>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <div className="search-wrap" style={{ flex: 1 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="text" className="search-input" placeholder="Search name or roll no." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button type="button" className="search-clear-btn" onClick={() => setSearch('')} aria-label="Clear search">✕</button>}
        </div>
      </div>

      {/* Paid / Unpaid filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="btn btn-outline btn-sm" style={{ flex: 1, fontSize: 12, padding: '7px 9px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => setPopup('status')}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {STATUS_OPTIONS.find(o => o.v === statusFilter)?.l} ({
              statusFilter === 'outstanding' ? outstandingRows.length
              : statusFilter === 'paid' ? paidRows.length
              : statusFilter === 'partial' ? partialRows.length
              : statusFilter === 'unpaid' ? unpaidRows.length
              : allRows.length
            }){isAdmin && (
              <span style={{ color: '#1a9c4b', fontWeight: 800 }}> · ₹{activeAmountTotal}</span>
            )}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11 }}>▼</span>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 90 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--gray)' }}>Loading…</div>}

        {!loading && activeRows.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--gray)' }}>
            {statusFilter === 'paid' ? 'No paid students yet.'
              : statusFilter === 'partial' ? 'No partially paid students.'
              : statusFilter === 'unpaid' ? 'No unpaid students 🎉'
              : statusFilter === 'outstanding' ? 'No unpaid or partially paid students 🎉'
              : 'No students to show.'}
          </div>
        )}

        {!loading && viewMode === 'year' ? (
          periods.map(p => {
            const pRows = p.rows.filter(r => matchesStatusFilter(r.status, statusFilter));
            if (pRows.length === 0) return null;
            return (
              <div key={p.monthKey}>
                <div style={{ padding: '6px 4px', fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>{monthLabelFor(p.monthKey)}</div>
                {pRows.map(r => (
                  <FeeRow key={r.key + r.monthKey} row={r} isAdmin={isAdmin} onReminder={openReminder} onThankYou={openThankYou} onEdit={openEntry} getPending={getPending} onShowPending={setPendingPopup} />
                ))}
              </div>
            );
          })
        ) : (
          !loading && activeRows.map(r => (
            <FeeRow key={r.key + r.monthKey} row={r} isAdmin={isAdmin} onReminder={openReminder} onThankYou={openThankYou} onEdit={openEntry} getPending={getPending} onShowPending={setPendingPopup} />
          ))
        )}

      </div>

      {pendingPopup && (
        <FilterPopup title={`⚠️ Pending fees — ${pendingPopup.student.name}`} onClose={() => setPendingPopup(null)}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
            {pendingPopup.sport}{pendingPopup.batchLabel ? ` · ${pendingPopup.batchLabel}` : ''} · {pendingPopup.items.length} earlier month{pendingPopup.items.length > 1 ? 's' : ''} not fully paid
          </div>
          {pendingPopup.items.map(it => (
            <button
              key={it.monthKey}
              type="button"
              onClick={() => openPendingMonth(it)}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
            >
              <span style={{ fontWeight: 600 }}>{monthLabelFor(it.monthKey)}</span>
              <span style={{ fontSize: 11, color: it.status === 'partial' ? '#e0a020' : 'var(--red)' }}>
                {it.status === 'partial' && it.due != null
                  ? `Partial · ₹${it.paid} of ₹${it.due} paid`
                  : it.due != null ? `Unpaid · ₹${it.due}` : 'Unpaid'} ›
              </span>
            </button>
          ))}
          <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 8 }}>Tap a month to record its payment.</div>
        </FilterPopup>
      )}

      {sendModal && (
        <SendMessageModal
          student={sendModal.student}
          month={sendModal.month}
          kind={sendModal.kind}
          initialText={sendModal.text}
          onClose={() => setSendModal(null)}
          onSent={(type) => recordMsgSent(sendModal.row, sendModal.kind, type)}
        />
      )}

      {entryModal && (
        <FeeEntryModal
          student={entryModal.student}
          monthKey={entryModal.monthKey}
          monthLabel={entryModal.monthLabel}
          sport={entryModal.sport}
          batchLabel={entryModal.batchLabel}
          fee={entryModal.fee}
          nextTxnSeq={(txnCounts[entryModal.student.id] || 0) + 1}
          onClose={() => setEntryModal(null)}
          onMultiMonth={() => {
            const { student, sport, batchLabel, monthKey } = entryModal;
            // Offer earlier unpaid months plus the next 11, minus anything already fully paid.
            const pend = getPending({ student, sport, batchLabel, monthKey }).map(i => i.monthKey);
            const ahead = Array.from({ length: 12 }, (_, k) => stepMonthKey(monthKey, k));
            const months = Array.from(new Set([...pend, ...ahead]))
              .filter(mk => mk === monthKey || feeStatus(pendingLookup.get(`${student.id}|${norm(sport)}|${norm(batchLabel)}|${mk}`)) !== 'paid')
              .sort();
            const b = (visibleBatches || []).find(x => norm(x.sport) === norm(sport) && norm(x.batchLabel) === norm(batchLabel));
            const f = b ? (b.defaultFee ?? b.default_fee ?? null) : null;
            setMultiModal({ student, sport, batchLabel, months, startMonthKey: monthKey, defaultFee: f !== null && f !== undefined && Number(f) > 0 ? Number(f) : null });
            setEntryModal(null);
          }}
          onSaved={(updated) => {
            const wasFullyPaid = feeStatus(entryModal.fee) === 'paid';
            if (rowInScope(updated)) {
              setFees(prev => {
                const idx = prev.findIndex(f => f.id === updated.id);
                if (idx === -1) return [...prev, updated];
                const next = [...prev];
                next[idx] = updated;
                return next;
              });
            }
            setAllFees(prev => {
              const same = f => f.student_id === updated.student_id && f.month === updated.month
                && norm(f.sport) === norm(updated.sport) && norm(f.batch_label) === norm(updated.batch_label);
              return [...prev.filter(f => !same(f)), updated];
            });
            // Optimistic local bump so a second payment opened right after
            // this one still gets the correct next sequence number, without
            // waiting on the debounced realtime refetch to catch up.
            const oldCount = (entryModal.fee?.payments || []).length;
            const newCount = (updated.payments || []).length;
            if (newCount !== oldCount) {
              setTxnCounts(prev => ({
                ...prev,
                [updated.student_id]: Math.max(0, (prev[updated.student_id] || 0) + (newCount - oldCount)),
              }));
            }
            setEntryModal(null);
            // Payment just crossed from partial/unpaid to fully paid — prompt
            // to send the thank-you message right away instead of making
            // staff hunt the row down in the Paid tab afterward. If they
            // close the popup without sending, recordMsgSent never runs, so
            // it's never counted.
            if (!wasFullyPaid && feeStatus(updated) === 'paid') {
              openThankYou({
                student: entryModal.student,
                sport: entryModal.sport,
                batchLabel: entryModal.batchLabel,
                monthKey: entryModal.monthKey,
                fee: updated,
              });
            }
          }}
        />
      )}

      {multiModal && (
        <MultiMonthModal
          student={multiModal.student}
          sport={multiModal.sport}
          batchLabel={multiModal.batchLabel}
          months={multiModal.months}
          startMonthKey={multiModal.startMonthKey}
          defaultFee={multiModal.defaultFee}
          nextTxnSeq={(txnCounts[multiModal.student.id] || 0) + 1}
          onClose={() => setMultiModal(null)}
          onSaved={(rows) => {
            const sid = multiModal.student.id;
            rows.forEach(updated => {
              if (!rowInScope(updated)) return;
              setFees(prev => {
                const idx = prev.findIndex(f => f.id === updated.id);
                if (idx === -1) return [...prev, updated];
                const next = [...prev];
                next[idx] = updated;
                return next;
              });
            });
            const keyOf = f => `${f.student_id}|${norm(f.sport)}|${norm(f.batch_label)}|${f.month}`;
            setAllFees(prev => {
              const ks = new Set(rows.map(keyOf));
              return [...prev.filter(f => !ks.has(keyOf(f))), ...rows];
            });
            // Each saved month carries exactly one new payment entry.
            setTxnCounts(prev => ({ ...prev, [sid]: (prev[sid] || 0) + rows.length }));
            setMultiModal(null);
          }}
        />
      )}

      {showImport && (
        <ImportFeesModal
          academyId={academyId}
          existingStudents={visibleStudents}
          sportFilter={sportFilter}
          batchFilter={batchFilter}
          collectedBy={collectedBy}
          isAdmin={isAdmin}
          canImport={canImportFees}
          onClose={() => setShowImport(false)}
          onImported={() => { loadFees(); loadTxnCounts(); }}
        />
      )}
    </div>
  );
}

function FeeRow({ row, isAdmin, onReminder, onThankYou, onEdit, getPending, onShowPending }) {
  const { student, sport, batchLabel, fee, status, paid } = row;
  const pendingItems = getPending ? getPending(row) : [];
  const editable = canEditFee(fee, isAdmin);
  const scholarship = !!fee?.is_scholarship;
  // A fee row can exist purely because a reminder was logged against it (see
  // recordMsgSent) — that shouldn't flip the button to "Edit". Only treat it
  // as a real entry once someone has actually saved payment info.
  const hasEntry = !!fee?.collected_by;
  const partial = status === 'partial';
  const due = fee?.amount_due ? parseInt(fee.amount_due, 10) : null;
  const amountPaid = fee?.amount ? parseInt(fee.amount, 10) : 0;
  const remaining = due != null ? Math.max(due - amountPaid, 0) : null;
  const btnLabel = scholarship ? '🔒 Scholarship' : paid && !editable ? '🔒 Paid' : (partial ? '➕ Add Payment' : (hasEntry ? '✏️ Edit' : '💳 Pay'));
  const badgeLabel = scholarship ? 'scholarship' : paid ? 'paid' : partial ? 'partially paid' : 'unpaid';
  const reminderCount = (fee?.msg_sent || []).filter(m => m.kind === 'reminder').length;
  const thankYouCount = (fee?.msg_sent || []).filter(m => m.kind === 'paid').length;

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 10px', marginBottom: 8, flexWrap: 'nowrap', overflow: 'hidden' }}>
      <div style={{ flex: '1 1 0%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{student.name}</span>
          {pendingItems.length > 0 && (
            <button
              type="button"
              title={`Pending fees for ${pendingItems.length} earlier month${pendingItems.length > 1 ? 's' : ''}`}
              onClick={() => onShowPending({ student, sport, batchLabel, items: pendingItems })}
              style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid rgba(224,160,32,0.5)', background: 'rgba(224,160,32,0.15)', color: '#e0a020' }}
            >
              ⚠️ {pendingItems.length} pending
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sport}{batchLabel ? ` · ${batchLabel}` : ''}
          {scholarship && <span style={{ color: 'var(--gold, #e0a020)' }}> · 🎓 fee waived</span>}
          {!scholarship && partial && due != null && <span style={{ color: 'var(--gold)' }}> · ₹{amountPaid}/₹{due} (₹{remaining} left)</span>}
          {!scholarship && fee?.method && <span> · {fee.method}</span>}
          {fee?.collected_by && <span style={{ color: 'var(--gold)' }}> · 👤 {fee.collected_by}</span>}
        </div>
      </div>
      <span
        className={'badge ' + (scholarship ? 'badge-gold' : paid ? 'badge-green' : partial ? 'badge-orange' : 'badge-red')}
        style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, flexShrink: 0, whiteSpace: 'nowrap', ...(partial && !scholarship ? { background: 'rgba(230,160,20,0.18)', color: '#e0a020' } : {}), ...(scholarship ? { background: 'rgba(160,120,255,0.18)', color: '#a078ff' } : {}) }}
      >
        {badgeLabel}
        {isAdmin && !scholarship && (paid || partial) && amountPaid > 0 ? ` · ₹${amountPaid}` : ''}
      </span>
      {paid ? (
        <button className="btn btn-outline" title="Send thank-you" style={{ fontSize: 10, padding: '3px 7px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => onThankYou(row)}>🎉{thankYouCount > 0 ? ` ${thankYouCount}` : ''}</button>
      ) : (
        <button className="btn btn-outline" title="Send reminder" style={{ fontSize: 10, padding: '3px 7px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => onReminder(row)}>💬{reminderCount > 0 ? ` ${reminderCount}` : ''}</button>
      )}
      <button
        className="btn btn-primary"
        title={btnLabel}
        style={{ fontSize: 10, padding: '3px 7px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap', opacity: paid && !editable ? 0.5 : 1 }}
        disabled={paid && !editable}
        onClick={() => editable && onEdit(row)}
      >
        {btnLabel}
      </button>
    </div>
  );
}
