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

// ---------------------------------------------------------------------------
// Presentation-only helpers (icons, styles) — same look as StudentsTab /
// AttendanceTab. No fee, payment or data logic lives here.
// ---------------------------------------------------------------------------

// Outline icons (Lucide-style, 24px grid, round caps/joins, one stroke weight).
const ICONS = {
  wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>,
  fileText: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  sheet: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M8 13h2" /><path d="M14 13h2" /><path d="M8 17h2" /><path d="M14 17h2" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  upload: <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 17v3h16v-3" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  search: <><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  messageCheck: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="m9 10 2 2 4-4" /></>,
  creditCard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  edit: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  checkCircle: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></>,
  xCircle: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  unlock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>,
  minusCircle: <><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></>,
  award: <><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></>,
};

function Icon({ name, size = 18, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}>
      {ICONS[name]}
    </svg>
  );
}

// Scoped hover / press / focus styles and small transitions. Prefixed `fe-`.
const FEES_CSS = `
.fe-btn{transition:transform .12s ease,background-color .15s ease,border-color .15s ease,box-shadow .15s ease,opacity .15s ease,color .15s ease}
.fe-btn:active:not(:disabled){transform:scale(.96)}
.fe-btn:disabled{cursor:not-allowed}
.fe-btn:focus-visible,.fe-search:focus-visible{outline:2px solid #5B7CC4;outline-offset:2px}
.fe-round:hover:not(:disabled){background:#EEF2FA}
.fe-chip:hover{border-color:#9DB2DD}
.fe-msg:hover:not(:disabled){background:#EEF2FA;border-color:#9DB2DD}
.fe-pay:hover:not(:disabled){background:#14295A}
.fe-summary:hover{border-color:#9DB2DD}
.fe-search{transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.fe-search:focus{border-color:#5B7CC4 !important;box-shadow:0 0 0 3px rgba(91,124,196,.18);background:#fff !important}
.fe-list .fe-card{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(16,32,64,.04);transition:border-color .15s ease,box-shadow .15s ease}
@media (hover:hover){.fe-list .fe-card:hover{border-color:#B9C7E6;box-shadow:0 2px 8px rgba(16,32,64,.07)}}
@keyframes fe-fade{from{opacity:0}to{opacity:1}}
@keyframes fe-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.fe-overlay{animation:fe-fade .15s ease}
.fe-sheet,.fe-panel{animation:fe-pop .16s ease}
.fe-input{width:100%;height:40px;box-sizing:border-box;padding:0 12px;border:1px solid var(--border);border-radius:10px;background:var(--card2);font-size:14px;color:#182238;font-family:inherit;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.fe-input:focus{border-color:#5B7CC4;box-shadow:0 0 0 3px rgba(91,124,196,.18);background:#fff}
.fe-input[readonly]{opacity:.75}
.fe-seg:hover:not([aria-pressed="true"]){border-color:#9DB2DD}
@media (prefers-reduced-motion:reduce){.fe-btn,.fe-search,.fe-card,.fe-overlay,.fe-sheet,.fe-panel{animation:none !important;transition:none !important}}
`;

// Equal-size filter chip; highlighted light blue when a filter is applied.
function chipStyle(on) {
  return {
    flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0,
    height: 36, fontSize: 12, fontWeight: 600, padding: '0 8px', borderRadius: 10, fontFamily: 'inherit',
    border: `1px solid ${on ? '#5B7CC4' : 'var(--border)'}`,
    background: on ? 'rgba(91,124,196,.10)' : 'var(--card2)', color: '#1A336A', cursor: 'pointer',
  };
}

// Round icon-only header action (PDF / Excel / Import) — identical to the
// Students tab: white circle, navy ring, navy icon.
function roundIconBtn(disabled) {
  return {
    width: 36, height: 36, borderRadius: '50%', border: '2px solid #04213A', padding: 0, flexShrink: 0,
    background: '#fff', color: '#04213A', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(4,33,58,.2)', opacity: disabled ? 0.5 : 1,
  };
}

// Small square prev/next arrows beside the month / year buttons.
const arrowBtnStyle = {
  width: 28, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: '#1A336A',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
};

function ArrowGroup({ onPrev, onNext, prevLabel, nextLabel, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 45%', minWidth: 120 }}>
      <button type="button" className="fe-btn" style={arrowBtnStyle} onClick={onPrev} aria-label={prevLabel} title={prevLabel}><Icon name="chevronLeft" size={15} /></button>
      {children}
      <button type="button" className="fe-btn" style={arrowBtnStyle} onClick={onNext} aria-label={nextLabel} title={nextLabel}><Icon name="chevronRight" size={15} /></button>
    </div>
  );
}

// Centered popup shared by the Month / Year / Sport / Batch / Status pickers —
// same look as the Students screen. Props are unchanged.
function FilterPopup({ title, onClose, children }) {
  return (
    <div
      className="fe-overlay"
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="fe-sheet" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '14px 12px 10px', width: '100%', maxWidth: 320, maxHeight: 'min(68vh, 480px)', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(10,18,35,.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: 6, padding: '0 4px', flexShrink: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A336A', textAlign: 'center' }}>{title}</div>
          <button type="button" className="fe-btn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 0, width: 28, height: 28, borderRadius: '50%', background: '#F1F3F8', border: 'none', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function RadioRow({ name, checked, onChange, label }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, minHeight: 42, padding: '8px 10px', borderRadius: 10,
      cursor: 'pointer', margin: '2px 0', background: checked ? 'rgba(91,124,196,.12)' : 'transparent',
      color: checked ? '#1A336A' : '#333', fontWeight: checked ? 600 : 500, transition: 'background .15s ease, color .15s ease',
    }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} style={{ width: 18, height: 18, accentColor: '#1A336A', flexShrink: 0, cursor: 'pointer' }} />
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

// ---- Shared pieces for the payment popups (presentation only) ----
const feModalOverlay = { position: 'fixed', inset: 0, background: 'rgba(10,18,35,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const feModalSheet = { background: '#fff', borderRadius: 16, padding: '16px 16px 14px', width: '100%', maxWidth: 400, maxHeight: 'min(90vh, 680px)', overflowY: 'auto', boxShadow: '0 12px 32px rgba(10,18,35,.24)' };
const feInfoBox = { background: '#F5F7FC', border: '1px solid #E3E9F5', borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: 12.5 };

function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
          <Icon name="wallet" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>{title}</span>
        </div>
        <button type="button" className="fe-btn" onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: '50%', background: '#F1F3F8', border: 'none', color: '#6B7385', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="x" size={15} />
        </button>
      </div>
      {subtitle && <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function ModalError({ children }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.28)', color: '#B91C1C', borderRadius: 10, padding: '8px 10px', fontSize: 12.5, marginBottom: 10 }}>
      <span style={{ display: 'flex', marginTop: 1 }}><Icon name="alert" size={15} /></span>
      <span>{children}</span>
    </div>
  );
}

function ModalFooter({ onCancel, onSave, saving }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <button type="button" className="fe-btn fe-msg" onClick={onCancel} style={{ flex: 1, height: 44, border: '1px solid #C5D0EA', borderRadius: 12, background: '#fff', color: '#1A336A', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
      <button type="button" className="fe-btn fe-pay" onClick={onSave} disabled={saving} style={{ flex: 2, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid #1A336A', borderRadius: 12, background: '#1A336A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
        {!saving && <Icon name="checkCircle" size={17} />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// One form line with the label on the left and its input on the right
// (e.g. "Total Amount Due ₹ ........ 600"). `hint` is a small grey line
// under the label; `boxWidth` sets how wide the right-hand box is.
function FieldRow({ label, hint, boxWidth = 140, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <label style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#182238' }}>
        {label}
        {hint && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray)', marginTop: 2 }}>{hint}</div>}
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

  const payTypeBtn = (key, label, icon, activeBg) => {
    const on = payType === key;
    return (
      <button
        type="button"
        className="fe-btn fe-seg"
        aria-pressed={on}
        onClick={() => setPayType(key)}
        style={{ flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, border: `1px solid ${on ? activeBg : 'var(--border)'}`, background: on ? activeBg : 'var(--card2)', color: on ? '#fff' : '#1A336A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', whiteSpace: 'nowrap' }}
      >
        <Icon name={icon} size={15} />{label}
      </button>
    );
  };

  return (
    <div className="fe-overlay" style={feModalOverlay} onClick={e => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={`Fee payment for ${student.name}`}>
      <div className="fe-sheet" style={feModalSheet}>
        <ModalHeader
          title={student.name}
          subtitle={`${monthLabel} · ${sport}${batchLabel ? ` · ${batchLabel}` : ''}`}
          onClose={onClose}
        />

        {error && <ModalError>{error}</ModalError>}

        {!isFirstEntry && (
          <div style={feInfoBox}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--gray)' }}>Total Due</span><span style={{ fontWeight: 600 }}>₹{due}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--gray)' }}>Paid So Far</span><span style={{ fontWeight: 600 }}>₹{paidSoFar}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Remaining</span><span style={{ color: remaining > 0 ? '#B91C1C' : '#166534' }}>₹{remaining}</span>
            </div>
            {lastPayment && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #E3E9F5', color: 'var(--gray)', fontSize: 12 }}>
                Last payment: ₹{lastPayment.amount} · {lastPayment.method} · {lastPayment.by}
                {lastPayment.at && <> · {new Date(lastPayment.at).toLocaleDateString()}</>}
                {lastPayment.transaction_id && <div style={{ marginTop: 2 }}>{lastPayment.transaction_id}</div>}
                {lastPayment.note && <div style={{ marginTop: 2, fontStyle: 'italic' }}>Note: {lastPayment.note}</div>}
              </div>
            )}
          </div>
        )}

        {locked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--gray)', marginBottom: 12 }}>
            <Icon name="lock" size={16} /> This fee is fully paid. Only an admin can reopen it.
          </div>
        ) : (
          <>
            {isFirstEntry && (
              <FieldRow
                label="Total Amount Due ₹"
                hint={batchDefaultFee != null ? `Batch default: ₹${batchDefaultFee.toLocaleString('en-IN')}` : null}
              >
                <input type="number" min="1" className="fe-input" style={{ textAlign: 'right' }} value={totalDue} onChange={e => setTotalDue(e.target.value)} placeholder="e.g. 300" />
              </FieldRow>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#182238', marginBottom: 6 }}>Payment Type</div>
              <div role="group" aria-label="Payment type" style={{ display: 'flex', gap: 6 }}>
                {payTypeBtn('full', 'Full', 'checkCircle', '#1A336A')}
                {payTypeBtn('partial', 'Partial', 'minusCircle', '#1A336A')}
                {payTypeBtn('scholarship', 'Scholarship', 'award', '#6D28D9')}
              </div>
            </div>

            {payType === 'scholarship' ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.28)', borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: 12.5, color: '#5B21B6' }}>
                <span style={{ display: 'flex', marginTop: 1 }}><Icon name="award" size={16} /></span>
                <span>This student is on scholarship — no payment is required. This fee will be marked fully settled with ₹0 collected.</span>
              </div>
            ) : (
              <>
                <FieldRow
                  label="Amount Paying Now ₹"
                  hint={isFirstEntry ? 'Leave blank if none yet' : `Remaining ₹${remaining}`}
                >
                  <input
                    type="number" min={isFirstEntry ? '0' : '1'} className="fe-input" style={{ textAlign: 'right' }} value={payNow}
                    onChange={e => { setPayNow(e.target.value); setPayType('partial'); }}
                    placeholder="Amount"
                    readOnly={payType === 'full'}
                  />
                </FieldRow>

                {(isFirstEntry ? parseInt(payNow, 10) > 0 : true) && (
                  <>
                    <FieldRow label="Payment Method">
                      <select className="fe-input" value={method} onChange={e => setMethod(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="bank">Bank Transfer</option>
                      </select>
                    </FieldRow>

                    <FieldRow label="Transaction ID" hint="Auto-generated" boxWidth={190}>
                      <input type="text" className="fe-input" value={txnId} readOnly style={{ fontSize: 12, textAlign: 'right' }} />
                    </FieldRow>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#182238', marginBottom: 6 }}>Note (optional)</div>
                      <input
                        type="text" maxLength={100} className="fe-input" value={note}
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
          <div style={{ fontSize: 11.5, color: 'var(--gray)', marginBottom: 8 }}>Last saved by: {fee.collected_by}</div>
        )}

        {isAdmin && status !== 'unpaid' && !confirmReset && (
          <button type="button" className="fe-btn" style={{ width: '100%', height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#B91C1C', background: 'transparent', border: '1px solid rgba(220,38,38,.35)', borderRadius: 10, marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setConfirmReset(true)}>
            <Icon name="unlock" size={15} /> Admin: Reset to Unpaid
          </button>
        )}
        {confirmReset && (
          <div style={{ fontSize: 12.5, marginBottom: 8, color: '#B91C1C', background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.25)', borderRadius: 10, padding: '10px 12px' }}>
            This clears all recorded payments for this entry. Are you sure?
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" className="fe-btn fe-msg" style={{ flex: 1, height: 36, border: '1px solid #C5D0EA', borderRadius: 10, background: '#fff', color: '#1A336A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="fe-btn" style={{ flex: 1, height: 36, border: '1px solid #DC2626', borderRadius: 10, background: '#DC2626', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }} onClick={resetToUnpaid} disabled={saving}>Confirm Reset</button>
            </div>
          </div>
        )}

        {!locked && onMultiMonth && payType !== 'scholarship' && (
          <button
            type="button"
            className="fe-btn fe-chip"
            onClick={onMultiMonth}
            style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: '1px dashed #9DB2DD', borderRadius: 10, marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#1A336A', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Icon name="calendar" size={16} /> Paying for multiple months?
          </button>
        )}

        {!locked && <ModalFooter onCancel={onClose} onSave={save} saving={saving} />}
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
    <div className="fe-overlay" style={feModalOverlay} onClick={e => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={`Multi-month payment for ${student.name}`}>
      <div className="fe-sheet" style={feModalSheet}>
        <ModalHeader
          title={student.name}
          subtitle={`${sport}${batchLabel ? ` · ${batchLabel}` : ''} · pay several months at once`}
          onClose={onClose}
        />

        {error && <ModalError>{error}</ModalError>}
        {!existing && <div style={{ fontSize: 13, color: 'var(--gray)', padding: '10px 0' }}>Loading…</div>}

        {existing && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#182238', marginBottom: 6 }}>Months to pay</div>
            <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 12px', marginBottom: 12 }}>
              {months.map(mk => {
                const ex = existing[mk];
                const due = ex?.amount_due ? parseInt(ex.amount_due, 10) : null;
                const paid = ex?.amount ? parseInt(ex.amount, 10) : 0;
                return (
                  <label key={mk} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(mk)} onChange={() => toggle(mk)} style={{ width: 18, height: 18, accentColor: '#1A336A', flexShrink: 0, cursor: 'pointer' }} />
                    <span style={{ flex: 1, fontWeight: 600, color: '#182238' }}>{monthKeyLabel(mk)}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>
                      {due != null ? (paid > 0 ? `₹${paid} of ₹${due} paid` : `₹${due} due`) : 'no entry yet'}
                    </span>
                  </label>
                );
              })}
            </div>

            <FieldRow label="Amount per month ₹" hint="For months with no amount set yet">
              <input type="number" min="1" className="fe-input" style={{ textAlign: 'right' }} value={perMonth} onChange={e => setPerMonth(e.target.value)} placeholder="e.g. 500" />
            </FieldRow>

            <FieldRow label="Total received ₹" hint={sumRemaining > 0 ? `Selected months need ₹${sumRemaining}` : null}>
              <input
                type="number" min="1" className="fe-input" style={{ textAlign: 'right' }} value={total}
                onChange={e => { setTotal(e.target.value); setTotalTouched(true); }}
                placeholder="Amount"
              />
            </FieldRow>

            {alloc.length > 0 && (parseInt(total, 10) || 0) > 0 && (
              <div style={feInfoBox}>
                <div style={{ color: 'var(--gray)', marginBottom: 4 }}>How it will be applied</div>
                {alloc.map(a => {
                  const newPaid = a.paid + a.pay;
                  const st = a.pay === 0 ? 'unchanged' : (newPaid >= a.due ? 'Paid' : `Partial · ₹${newPaid} of ₹${a.due}`);
                  return (
                    <div key={a.mk} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                      <span>{monthKeyLabel(a.mk)}</span>
                      <span style={{ fontWeight: 600, color: a.pay === 0 ? 'var(--gray)' : (st === 'Paid' ? '#166534' : '#92400E') }}>
                        {a.pay > 0 ? `₹${a.pay} → ` : ''}{st}
                      </span>
                    </div>
                  );
                })}
                {leftover > 0 && <div style={{ color: '#B91C1C', marginTop: 4 }}>₹{leftover} more than these months need — select more months.</div>}
              </div>
            )}

            <FieldRow label="Payment Method">
              <select className="fe-input" value={method} onChange={e => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
              </select>
            </FieldRow>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#182238', marginBottom: 6 }}>Note (optional)</div>
              <input type="text" maxLength={100} className="fe-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Paid 3 months in advance" />
            </div>

            <ModalFooter onCancel={onClose} onSave={save} saving={saving} />
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
  const [showDownload, setShowDownload] = useState(false); // PDF / Excel chooser

  // A row's `month` key is fine to compare lexically ('2026-01' <= '2026-08')
  // since it's always YYYY-MM. Used both for the scoped fetch below and to
  // decide whether an incoming realtime row belongs on screen right now.
  const monthKeyFor = (y, m) => `${y}-${pad(m)}`;
  const rowInScope = (row) => {
    if (!row?.month) return false;
    return viewMode === 'year' ? row.month.slice(0, 4) === String(year) : row.month === monthKeyFor(year, month);
  };

  // Collapse the filters card when the user taps anywhere outside it.
  // Skipped while a picker popup is open (those render outside the card, and
  // choosing an option there shouldn't close the panel behind it).
  const filtersRef = useRef(null);
  useEffect(() => {
    if (!filtersOpen || popup) return;
    // Listen for the CLICK (not pointerdown): the tapped control's own onClick
    // runs first, and only then does the panel collapse. Collapsing on
    // pointerdown shifted the layout under the finger, so the tap on the real
    // target (Pay, Edit, filters...) was lost and had to be repeated.
    // Registered on the next tick so the click that just closed a popup (or
    // opened this panel) isn't mistaken for an outside click.
    const onOutsideClick = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    };
    // Also hide when the user scrolls anywhere outside the card. Ignored for
    // the first moments after opening so layout shifts don't count.
    const armedAt = Date.now() + 400;
    const onOutsideScroll = (e) => {
      if (Date.now() < armedAt) return;
      if (filtersRef.current && e.target instanceof Node && filtersRef.current.contains(e.target)) return;
      setFiltersOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
    document.addEventListener('scroll', onOutsideScroll, true);
    return () => { clearTimeout(t); document.removeEventListener('click', onOutsideClick); document.removeEventListener('scroll', onOutsideScroll, true); };
  }, [filtersOpen, popup]);

  // Tapping the search field while it already has text selects it all,
  // so typing immediately replaces the previous query. No-op on an empty field.
  const selectAllOnTap = (e) => {
    if (e.target.value) e.target.select();
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
        <div style={{ display: 'flex', color: 'var(--gray)', marginBottom: 10 }}><Icon name="lock" size={32} stroke={1.75} /></div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No access to Fees</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>Ask an admin to grant you access to this tab.</div>
      </div>
    );
  }

  // Presentation-only: label + count shown on the status summary card. Same
  // expressions the old inline summary used.
  const statusLabel = STATUS_OPTIONS.find(o => o.v === statusFilter)?.l;
  const statusCount = statusFilter === 'outstanding' ? outstandingRows.length
    : statusFilter === 'paid' ? paidRows.length
    : statusFilter === 'partial' ? partialRows.length
    : statusFilter === 'unpaid' ? unpaidRows.length
    : allRows.length;

  return (
    <div className="page active fe-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'inherit' }}>
      <style>{FEES_CSS}</style>

      {/* Header: title + PDF / Excel / Import icon buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1A336A', minWidth: 0 }}>
          <Icon name="wallet" size={20} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' }}>Fees</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
          {canExportFees && hasFeature('has_reports') && (
            <button type="button" className="fe-btn fe-round" style={roundIconBtn(false)} aria-label="Download fees" title="Download" onClick={() => setShowDownload(true)}><Icon name="download" size={18} /></button>
          )}
          {canExportFees && !hasFeature('has_reports') && (() => {
            const target = cheapestPlanWithFeature('has_reports');
            const msg = target ? `Upgrade to ${target.name} to unlock exports` : 'Not available on your plan';
            return (
              <button type="button" className="fe-btn fe-round" style={roundIconBtn(true)} disabled aria-label={msg} title={msg}>
                <Icon name="lock" size={16} />
              </button>
            );
          })()}
          {canImportFees && hasFeature('has_bulk_import') && (
            <button type="button" className="fe-btn fe-round" style={roundIconBtn(false)} aria-label="Import fees" title="Import" onClick={() => setShowImport(true)}><Icon name="upload" size={18} /></button>
          )}
          {canImportFees && !hasFeature('has_bulk_import') && (() => {
            const target = cheapestPlanWithFeature('has_bulk_import');
            const msg = target ? `Upgrade to ${target.name} to unlock bulk import` : 'Not available on your plan';
            return (
              <button type="button" className="fe-btn fe-round" style={roundIconBtn(true)} disabled aria-label={msg} title={msg}>
                <Icon name="lock" size={16} />
              </button>
            );
          })()}
        </div>
      </div>

      {/* Filters card: view mode, month, year, sport, batch (collapsible) */}
      <div ref={filtersRef} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '4px 10px', marginBottom: 6, boxShadow: '0 1px 2px rgba(16,32,64,.05)', flexShrink: 0 }}>
        <div
          role="button" tabIndex={0} aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(v => !v)}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFiltersOpen(v => !v); } }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', minHeight: 36 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ display: 'flex', color: '#1A336A' }} aria-hidden="true"><Icon name="calendar" size={18} /></span>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#182238', whiteSpace: 'nowrap' }}>{viewMode === 'year' ? `Full Year ${year}` : `${MONTHS[month - 1]} ${year}`}</span>
            {(sportFilter || batchFilter) && (
              <span style={{ fontSize: 11.5, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{[sportFilter, batchFilter].filter(Boolean).join(' · ')}</span>
            )}
          </div>
          <button type="button" className="fe-btn" style={{ ...arrowBtnStyle, border: 'none', background: 'var(--card2)', borderRadius: '50%', width: 28 }}
            aria-label={filtersOpen ? 'Collapse filters' : 'Expand filters'} aria-expanded={filtersOpen}
            onClick={(e) => { e.stopPropagation(); setFiltersOpen(v => !v); }}>
            <Icon name={filtersOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        </div>

        {filtersOpen && (
          <div className="fe-panel" style={{ marginTop: 8, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--card2)', border: '1px solid var(--border)' }}>
              {[['month', 'Month'], ['year', 'Full Year']].map(([m, l]) => (
                <button key={m} type="button" className="fe-btn" aria-pressed={viewMode === m}
                  style={{ flex: 1, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, background: viewMode === m ? '#1A336A' : 'transparent', color: viewMode === m ? '#fff' : '#1A336A' }}
                  onClick={() => setViewMode(m)}>
                  {l}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {viewMode === 'month' && (
                <ArrowGroup onPrev={goPrevMonth} onNext={goNextMonth} prevLabel="Previous month" nextLabel="Next month">
                  <button type="button" className="fe-btn fe-chip" style={{ ...chipStyle(false), height: 30, borderRadius: 8 }} onClick={() => setPopup('month')} aria-haspopup="dialog" aria-label="Select month">
                    {MONTHS[month - 1]}
                  </button>
                </ArrowGroup>
              )}
              <ArrowGroup onPrev={() => setYear(y => y - 1)} onNext={() => setYear(y => y + 1)} prevLabel="Previous year" nextLabel="Next year">
                <button type="button" className="fe-btn fe-chip" style={{ ...chipStyle(false), height: 30, borderRadius: 8 }} onClick={() => setPopup('year')} aria-haspopup="dialog" aria-label="Select year">
                  {year}
                </button>
              </ArrowGroup>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="fe-btn fe-chip" style={chipStyle(!!sportFilter)} onClick={() => setPopup('sport')} aria-haspopup="dialog" aria-label="Filter by sport">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sportFilter || 'All Sports'}</span>
                <Icon name="chevronDown" size={13} />
              </button>
              <button type="button" className="fe-btn fe-chip" style={chipStyle(!!batchFilter)} onClick={() => setPopup('batch')} aria-haspopup="dialog" aria-label="Filter by batch">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{batchFilter || 'All Batches'}</span>
                <Icon name="chevronDown" size={13} />
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

      {/* Search — same component look as the Students tab */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 12, display: 'flex', color: 'var(--gray)', pointerEvents: 'none' }}>
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          className="fe-search"
          placeholder="Search name or roll no."
          aria-label="Search students by name or roll number"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={selectAllOnTap}
          onClick={selectAllOnTap}
          style={{
            width: '100%', height: 38, padding: '0 38px 0 36px', boxSizing: 'border-box', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card2)', fontSize: 13.5, fontWeight: 400,
            color: '#182238', outline: 'none', fontFamily: 'inherit',
          }}
        />
        {search && (
          <button type="button" className="fe-btn" onClick={() => setSearch('')} aria-label="Clear search"
            style={{ position: 'absolute', right: 7, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'var(--border)', color: 'var(--gray)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={13} stroke={2.4} />
          </button>
        )}
      </div>

      {/* Status summary: filter label + student count (+ collected amount for admins) */}
      <button
        type="button"
        className="fe-btn fe-summary"
        onClick={() => setPopup('status')}
        aria-haspopup="dialog"
        aria-label={`Filter by status: ${statusLabel}, ${statusCount} students${isAdmin ? `, ₹${activeAmountTotal}` : ''}`}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '6px 12px', marginBottom: 6, flexShrink: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,32,64,.05)', cursor: 'pointer', fontFamily: 'inherit', color: '#1A336A', textAlign: 'left' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{statusLabel}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 8px', borderRadius: 8, background: 'rgba(91,124,196,.12)', border: '1px solid rgba(91,124,196,.28)', whiteSpace: 'nowrap' }}>{statusCount}</span>
        </span>
        {isAdmin && (
          <span style={{ fontSize: 14, fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>₹{activeAmountTotal}</span>
        )}
        <Icon name="chevronDown" size={16} />
      </button>

      <div className="fe-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 90, marginTop: 2 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>Loading…</div>}

        {!loading && activeRows.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
            {statusFilter === 'paid' ? 'No paid students yet.'
              : statusFilter === 'partial' ? 'No partially paid students.'
              : statusFilter === 'unpaid' ? 'No unpaid students.'
              : statusFilter === 'outstanding' ? 'No unpaid or partially paid students.'
              : 'No students to show.'}
          </div>
        )}

        {!loading && viewMode === 'year' ? (
          periods.map(p => {
            const pRows = p.rows.filter(r => matchesStatusFilter(r.status, statusFilter));
            if (pRows.length === 0) return null;
            return (
              <div key={p.monthKey}>
                <div style={{ padding: '10px 4px 6px', fontSize: 12, fontWeight: 700, color: '#1A336A', textTransform: 'uppercase', letterSpacing: '.06em' }}>{monthLabelFor(p.monthKey)}</div>
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
        <FilterPopup title={`Pending fees — ${pendingPopup.student.name}`} onClose={() => setPendingPopup(null)}>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 8, padding: '0 4px' }}>
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

      {showDownload && (
        <FilterPopup title="Download as" onClose={() => setShowDownload(false)}>
          {[
            ['pdf', 'fileText', 'PDF', () => exportGenericPdf('Fees Report', exportColumns, exportRows.map(row => exportColumns.map(c => row[c])), 'fees.pdf')],
            ['xlsx', 'sheet', 'Excel', () => exportGenericXlsx(exportRows, 'fees.xlsx', 'Fees')],
          ].map(([kind, icon, label, run]) => (
            <button
              key={kind}
              type="button"
              className="fe-btn fe-chip"
              onClick={() => { setShowDownload(false); run(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '10px 12px', margin: '4px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card2)', color: '#1A336A', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ display: 'flex', color: '#1A336A' }}><Icon name={icon} size={20} /></span> {label}
            </button>
          ))}
        </FilterPopup>
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
  const btnLabel = scholarship ? 'Scholarship' : paid && !editable ? 'Paid' : (partial ? 'Add Payment' : (hasEntry ? 'Edit' : 'Pay'));
  const btnText = btnLabel === 'Add Payment' ? 'Add' : btnLabel; // compact on-screen text; full label stays in title/aria-label
  const btnIcon = scholarship || (paid && !editable) ? 'lock' : partial ? 'plus' : hasEntry ? 'edit' : 'creditCard';
  const badgeLabel = scholarship ? 'scholarship' : paid ? 'paid' : partial ? 'partially paid' : 'unpaid';
  const reminderCount = (fee?.msg_sent || []).filter(m => m.kind === 'reminder').length;
  const thankYouCount = (fee?.msg_sent || []).filter(m => m.kind === 'paid').length;
  const msgCount = paid ? thankYouCount : reminderCount;
  const msgLabel = paid ? 'Send thank-you' : 'Send reminder';

  // Status badge: icon + text (never colour alone), restrained tones.
  const tone = scholarship ? { bg: 'rgba(124,58,237,.10)', fg: '#6D28D9', bd: 'rgba(124,58,237,.30)', icon: 'award' }
    : paid ? { bg: 'rgba(22,163,74,.10)', fg: '#166534', bd: 'rgba(22,163,74,.30)', icon: 'checkCircle' }
    : partial ? { bg: 'rgba(245,158,11,.14)', fg: '#92400E', bd: 'rgba(245,158,11,.40)', icon: 'clock' }
    : { bg: 'rgba(220,38,38,.08)', fg: '#B91C1C', bd: 'rgba(220,38,38,.28)', icon: 'xCircle' };

  const meta = [];
  if (scholarship) meta.push('Fee waived (scholarship)');
  if (!scholarship && partial && due != null) meta.push(`₹${amountPaid}/₹${due} (₹${remaining} left)`);
  if (!scholarship && fee?.method) meta.push(fee.method);
  if (fee?.collected_by) meta.push(`Collected by ${fee.collected_by}`);

  return (
    <div className="fe-card">
      <div style={{ flex: '1 1 0%', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#182238', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{student.name}</div>
        <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
          {sport}{batchLabel ? ` · ${batchLabel}` : ''}
        </div>
        {meta.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--gray)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{meta.join(' · ')}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
            <Icon name={tone.icon} size={12} stroke={2.4} />
            {badgeLabel}
            {isAdmin && !scholarship && (paid || partial) && amountPaid > 0 ? ` · ₹${amountPaid}` : ''}
          </span>
          {pendingItems.length > 0 && (
            <button
              type="button"
              className="fe-btn"
              title={`Pending fees for ${pendingItems.length} earlier month${pendingItems.length > 1 ? 's' : ''}`}
              aria-label={`${pendingItems.length} pending earlier month${pendingItems.length > 1 ? 's' : ''} — view details`}
              onClick={() => onShowPending({ student, sport, batchLabel, items: pendingItems })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', border: '1px solid rgba(245,158,11,.40)', background: 'rgba(245,158,11,.14)', color: '#92400E' }}
            >
              <Icon name="alert" size={12} stroke={2.4} />
              {pendingItems.length} pending
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          className="fe-btn fe-msg"
          title={msgLabel}
          aria-label={msgCount > 0 ? `${msgLabel} (${msgCount} sent)` : msgLabel}
          style={{ height: 34, minWidth: 34, padding: msgCount > 0 ? '0 9px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, border: '1px solid #C5D0EA', borderRadius: 9, background: '#fff', color: '#1A336A', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => (paid ? onThankYou(row) : onReminder(row))}
        >
          <Icon name={paid ? 'messageCheck' : 'message'} size={16} />
          {msgCount > 0 && <span>{msgCount}</span>}
        </button>
        <button
          type="button"
          className="fe-btn fe-pay"
          title={btnLabel}
          aria-label={btnLabel}
          style={{ height: 34, padding: '0 11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, border: '1px solid #1A336A', borderRadius: 9, background: '#1A336A', color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit', opacity: paid && !editable ? 0.5 : 1 }}
          disabled={paid && !editable}
          onClick={() => editable && onEdit(row)}
        >
          <Icon name={btnIcon} size={15} />
          {btnText}
        </button>
      </div>
    </div>
  );
}
