import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

// kind: 'reminder' | 'paid'
export default function SendMessageModal({ student, month, kind, initialText, onClose, onSent }) {
  const { academyId, appUser, user } = useAuth();
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);

  const hasContact = !!student.contact;

  const send = async (type) => {
    if (!text.trim()) { alert('Message cannot be empty'); return; }
    if (!hasContact) { alert('No contact number for this student'); return; }
    setSending(true);
    const phone = student.contact.replace(/\D/g, '');
    if (type === 'whatsapp') {
      window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      window.open(`sms:${student.contact}?body=${encodeURIComponent(text)}`, '_blank');
    }
    const sentBy = appUser?.name || user?.email || '';
    const sentAt = new Date().toISOString();
    const { error } = await supabase.from('msg_logs').insert({
      academy_id: academyId, type, kind, to_name: student.name, contact: student.contact,
      month, sent_by: sentBy, sent_at: sentAt, message: text,
    });
    setSending(false);
    if (error) { alert('Logged failed: ' + error.message); }
    onSent?.(type);
    onClose();
  };

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-title">
          <span>{kind === 'paid' ? '🎉 Send Thank-You' : '💬 Send Fee Reminder'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ fontSize: 13, marginBottom: 10 }}>
          <b>{student.name}</b> · {student.batchLabel || student.batch || ''}{' '}
          {hasContact
            ? <span style={{ color: 'var(--accent2)' }}>📞 {student.contact}</span>
            : <span style={{ color: 'var(--gray)' }}>No contact</span>}
        </div>

        <div className="form-group">
          <textarea className="form-input" rows={5} style={{ resize: 'none', lineHeight: 1.6 }} value={text} onChange={e => setText(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1, opacity: hasContact ? 1 : 0.5 }} disabled={sending || !hasContact} onClick={() => send('sms')}>💬 SMS</button>
          <button className="btn btn-primary" style={{ flex: 1, opacity: hasContact ? 1 : 0.5 }} disabled={sending || !hasContact} onClick={() => send('whatsapp')}>📱 WhatsApp</button>
        </div>
      </div>
    </div>
  );
}
