import { useEffect, useState } from 'react';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';

export const DEFAULT_MSG = 'Dear {name}, your fee for {month} is pending at {academy}. Kindly pay at the earliest. Thank you.';
export const DEFAULT_THANK = 'Dear {name}, we have received your fee payment of ₹{amount} for {month} via {method}. Thank you for your continued trust in {academy}!';

export default function FeeMsgModal({ kind, onClose }) {
  const { academy, refreshAcademy } = useAcademyData();
  const isThank = kind === 'thank';
  const field = isThank ? 'thank_template' : 'msg_template';
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!academy) return;
    setText(academy[field] || (isThank ? DEFAULT_THANK : DEFAULT_MSG));
  }, [academy, field, isThank]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('academies').update({ [field]: text.trim(), updated_at: new Date().toISOString() }).eq('id', academy.id);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    await refreshAcademy();
    onClose();
  };

  if (!academy) return null;

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-title">
          <span>{isThank ? '🎉 Payment Thank-You Message' : '✅ Default Fee Reminder Message'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8, lineHeight: 1.6 }}>
          {isThank ? (
            <>Sent when a payment is recorded. Use <b style={{ color: 'var(--gold)' }}>{'{name}'}</b>, <b style={{ color: 'var(--gold)' }}>{'{month}'}</b>, <b style={{ color: 'var(--gold)' }}>{'{academy}'}</b>, <b style={{ color: 'var(--gold)' }}>{'{amount}'}</b>, <b style={{ color: 'var(--gold)' }}>{'{method}'}</b>.</>
          ) : (
            <>Use <b style={{ color: 'var(--gold)' }}>{'{name}'}</b> for student name, <b style={{ color: 'var(--gold)' }}>{'{month}'}</b> for fee month, <b style={{ color: 'var(--gold)' }}>{'{academy}'}</b> for academy name.</>
          )}
        </div>

        <textarea className="form-input" rows={5} style={{ resize: 'none', lineHeight: 1.7, marginBottom: 12 }} value={text} onChange={e => setText(e.target.value)} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
