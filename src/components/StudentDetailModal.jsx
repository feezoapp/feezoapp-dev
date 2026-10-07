import { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { logActivity } from '../lib/auditLog';
import { exportStudentProfilePdf } from '../lib/exporters';
import AchievementsSection from './AchievementsSection';

// Outline icons used by this popup (Lucide-style, round caps, one stroke weight).
const ICONS = {
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  edit: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  ban: <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></>,
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

function calcAge(dobIso) {
  if (!dobIso) return '';
  const d = new Date(dobIso);
  if (isNaN(d)) return '';
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--gray)', fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ContactRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--gray)', fontSize: 12 }}>{label}</span>
      <a href={`tel:${value}`} onClick={e => e.stopPropagation()}
        style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--accent2)', textDecoration: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="phone" size={13} /> {value}</span>
      </a>
    </div>
  );
}

export default function StudentDetailModal({ student, academyId, isAdmin, canViewContact, canExport, onClose, onEdit, onChanged }) {
  const { appUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isBanned = !!student.banned;
  // student.enrollments may include rows the student has since left
  // (active === false) — the "Sports Enrolled" section should only ever show
  // what's current, so split that once here rather than filtering inline
  // in several places.
  const allEnrollments = student.enrollments || [];
  const activeEnrollments = allEnrollments.filter(en => en.active !== false);
  const pastEnrollments = allEnrollments
    .filter(en => en.active === false)
    .sort((a, b) => (b.left_date || '').localeCompare(a.left_date || ''));

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const [{ data: academy }, { data: achievements }] = await Promise.all([
        supabase.from('academies').select('name, logo_url').eq('id', academyId).maybeSingle(),
        supabase.from('achievements').select('*').eq('student_id', student.id).eq('academy_id', academyId),
      ]);
      await exportStudentProfilePdf(student, academy || {}, achievements || [], canViewContact);
      logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Downloaded profile PDF for ${student.name}` });
    } catch (e) {
      alert(e.message || 'Failed to generate PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const toggleBan = async () => {
    setBusy(true);
    const banned = !isBanned;
    const bannedOn = banned
      ? (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()
      : null;
    await supabase.from('students').update({ banned, banned_on: bannedOn }).eq('id', student.id);
    setBusy(false);
    logActivity({
      academyId, actorId: appUser?.id, actorName: appUser?.name,
      message: banned ? `Marked student ${student.name} as dropout` : `Restored student ${student.name} from dropout`,
    });
    onChanged();
    onClose();
  };

  const doDelete = async () => {
    if (!isAdmin) return; // UI already hides this from staff; guard kept in case of direct calls
    if (!confirm(`Permanently delete "${student.name}"? Attendance & fee history will remain but be orphaned.`)) return;
    setBusy(true);
    await supabase.from('students').delete().eq('id', student.id);
    setBusy(false);
    logActivity({ academyId, actorId: appUser?.id, actorName: appUser?.name, message: `Deleted student ${student.name}` });
    onChanged();
    onClose();
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--card)', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '88vh', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(91,124,196,.14)', color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="user" size={17} /></span>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#1A336A' }}>Student Details</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleDownload}
              disabled={downloading}
              aria-label="Download Profile PDF"
              title="Download Profile PDF"
              style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)',
                border: '1px solid var(--border)', cursor: downloading ? 'wait' : 'pointer',
                fontSize: 14, color: '#1A336A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: downloading ? 0.6 : 1,
              }}
            >
              {downloading ? '…' : <Icon name="download" size={16} />}
            </button>
            <button onClick={onClose} aria-label="Close"
              style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--gray)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={16} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            {student.roll_no && (
              <div style={{ display: 'inline-flex', background: 'var(--accent2)', color: '#fff', borderRadius: 8, padding: '3px 14px', fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Roll No. {student.roll_no}
              </div>
            )}
            <div style={{ fontSize: 18, fontWeight: 700, color: '#182238' }}>{student.name}</div>
            {isBanned && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                <span className="badge badge-red" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10 }}>Dropout</span>
              </div>
            )}
          </div>

          <div style={{ color: 'var(--gray)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, marginTop: 4, }}><Icon name="user" size={14} /> Personal Info</div>
          <Row label="Age" value={student.dob ? calcAge(student.dob) : student.age} />
          <Row label="Date of Birth" value={student.dob} />
          <Row label="Gender" value={student.gender} />
          <Row label="Parent / Guardian" value={student.parent} />
          <ContactRow label="Contact 1" value={canViewContact ? student.contact : null} />
          <ContactRow label="Contact 2" value={canViewContact ? student.contact2 : null} />
          {!canViewContact && <div style={{ fontSize: 11, color: 'var(--gray)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} /> Contact number hidden. Ask admin to grant access.</div>}
          <Row label="School" value={student.school} />
          <Row label="Address" value={student.address} />
          <Row label="Joined" value={student.join_date} />

          {(student.height || student.weight || student.bmi) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ color: 'var(--gray)', fontSize: 11 }}>Height</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{student.height ? `${student.height} cm` : '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--gray)', fontSize: 11 }}>Weight</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{student.weight ? `${student.weight} kg` : '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--gray)', fontSize: 11 }}>BMI</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{student.bmi || '—'}</div>
              </div>
            </div>
          )}

          <div style={{ padding: '10px 0' }}>
            <div style={{ color: 'var(--gray)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, }}><Icon name="trophy" size={14} /> Sports Enrolled</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(activeEnrollments.length > 0
                ? activeEnrollments
                : [{ sport: student.sport, batchLabel: student.batchLabel }]
              ).map((en, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge badge-blue" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10 }}>
                    Sport: {en.sport}
                  </span>
                  <span className="badge badge-blue" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10 }}>
                    Batch: {en.batchLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {pastEnrollments.length > 0 && (
            <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--gray)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, }}><Icon name="clock" size={14} /> Past Enrollments</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastEnrollments.map((en, i) => (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span className="badge" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--card2)', color: 'var(--gray)' }}>
                        Sport: {en.sport}
                      </span>
                      <span className="badge" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--card2)', color: 'var(--gray)' }}>
                        Batch: {en.batchLabel}
                      </span>
                      {en.end_reason && (
                        <span className="badge" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'rgba(220,38,38,.1)', color: '#ef4444' }}>
                          {en.end_reason}
                        </span>
                      )}
                    </div>
                    {en.left_date && <div style={{ fontSize: 11, color: 'var(--gray)' }}>Left on {en.left_date}</div>}
                    {en.end_notes && <div style={{ fontSize: 11.5, marginTop: 2 }}>{en.end_notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <AchievementsSection studentId={student.id} academyId={academyId} canEdit={true} />
        </div>

        <div style={{ display: 'flex', gap: 6, padding: 16, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button className="btn btn-primary btn-sm" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} disabled={busy} onClick={() => { onClose(); onEdit(student); }}><Icon name="edit" size={15} /> Edit</button>
          {!isBanned
            ? <button className="btn btn-warning btn-sm" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} disabled={busy} onClick={toggleBan}><Icon name="ban" size={15} /> Block</button>
            : <button className="btn btn-success btn-sm" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} disabled={busy} onClick={toggleBan}><Icon name="restore" size={15} /> Restore</button>}
          {isAdmin && <button className="btn btn-danger btn-sm" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} disabled={busy} onClick={doDelete}><Icon name="trash" size={15} /> Delete</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}
