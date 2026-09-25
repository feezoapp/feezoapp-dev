import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import AcademyCard from '../components/AcademyCard';
import SettingsModal from '../components/SettingsModal';
import FeeMsgModal from '../components/FeeMsgModal';
import FeesLogModal from '../components/FeesLogModal';

const ADMIN_LINKS = [
  { to: '/admin/sports-batches', label: 'Sports & Batches', icon: '🥋' },
  { to: '/admin/users', label: 'User Management', icon: '👤' },
  { to: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

function RowButton({ icon, label, onClick }) {
  return (
    <button className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', width: '100%', textAlign: 'left', background: 'var(--card)', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={onClick}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--offwhite)' }}>{label}</span>
    </button>
  );
}

export default function ProfileTab() {
  const { isAdmin, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [msgModal, setMsgModal] = useState(null); // 'reminder' | 'thank' | null
  const [showFeesLog, setShowFeesLog] = useState(false);

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>👤 Profile</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
          <button className="btn btn-danger btn-sm" onClick={logout}>Sign Out</button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <AcademyCard />
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {ADMIN_LINKS.map(l => (
            <Link key={l.to} to={l.to} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
              <span style={{ fontSize: 18 }}>{l.icon}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{l.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {isAdmin && <RowButton icon="✅" label="Default Fee Reminder Message" onClick={() => setMsgModal('reminder')} />}
        {isAdmin && <RowButton icon="🎉" label="Payment Thank-You Message" onClick={() => setMsgModal('thank')} />}
        <RowButton icon="💰" label="Fees Log" onClick={() => setShowFeesLog(true)} />
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {msgModal && <FeeMsgModal kind={msgModal} onClose={() => setMsgModal(null)} />}
      {showFeesLog && <FeesLogModal onClose={() => setShowFeesLog(false)} />}
    </div>
  );
}
