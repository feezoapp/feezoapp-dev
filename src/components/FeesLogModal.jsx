import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { exportGenericPdf, exportGenericXlsx } from '../lib/exporters';

export default function FeesLogModal({ onClose }) {
  const { academyId } = useAuth();
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('reminder'); // 'reminder' | 'paid'
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!academyId) return;
    setLoading(true);
    const { data } = await supabase.from('msg_logs').select('*').eq('academy_id', academyId).order('sent_at', { ascending: false }).limit(200);
    setLogs(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [academyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = logs.filter(l => (l.kind || 'reminder') === tab);

  const exportRows = filtered.map(l => ({
    To: l.to_name, Contact: l.contact, Month: l.month, Type: l.type,
    'Sent By': l.sent_by, 'Sent At': l.sent_at ? new Date(l.sent_at).toLocaleString() : '',
  }));

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-title">
          <span>💰 Fees Log</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className="btn btn-xs btn-gold" onClick={() => exportGenericPdf('Fees Log', ['To', 'Contact', 'Month', 'Type', 'Sent By', 'Sent At'], exportRows.map(Object.values), 'fees-log.pdf')}>PDF</button>
          <button className="btn btn-xs btn-success" onClick={() => exportGenericXlsx(exportRows, 'fees-log.xlsx', 'Fees Log')}>XL</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: tab === 'reminder' ? 'var(--accent2)' : 'var(--card2)', color: tab === 'reminder' ? '#fff' : 'var(--gray)' }}
            onClick={() => setTab('reminder')}
          >💬 Fee Reminder</button>
          <button
            style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: tab === 'paid' ? 'var(--accent2)' : 'var(--card2)', color: tab === 'paid' ? '#fff' : 'var(--gray)' }}
            onClick={() => setTab('paid')}
          >✅ Fee Paid</button>
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--gray)' }}>Loading…</div>}
          {!loading && filtered.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--gray)' }}>No messages logged yet.</div>}
          {!loading && filtered.map(l => (
            <div key={l.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--offwhite)' }}>{l.to_name}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: l.type === 'whatsapp' ? '#22c55e' : 'var(--gray)' }}>
                  {l.type === 'whatsapp' ? '📱 WhatsApp' : '💬 SMS'}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{l.month} · {l.contact}</div>
              <div style={{ fontSize: 10, color: 'var(--graydk)', marginTop: 2 }}>
                by {l.sent_by} · {l.sent_at ? new Date(l.sent_at).toLocaleString() : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
