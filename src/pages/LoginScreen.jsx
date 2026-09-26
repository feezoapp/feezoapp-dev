import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const STARS = [
  { w: 2, top: '12%', left: '18%', dur: '2.8s', delay: '0s' },
  { w: 3, top: '22%', left: '70%', dur: '3.5s', delay: '.5s' },
  { w: 2, top: '35%', left: '42%', dur: '2.4s', delay: '1s' },
  { w: 2, top: '8%', left: '85%', dur: '3.1s', delay: '.3s' },
  { w: 3, top: '55%', left: '10%', dur: '4s', delay: '1.4s' },
  { w: 2, top: '68%', left: '80%', dur: '2.9s', delay: '.8s' },
  { w: 2, top: '78%', left: '30%', dur: '3.4s', delay: '2s' },
  { w: 3, top: '48%', left: '60%', dur: '3.7s', delay: '.2s' },
  { w: 2, top: '88%', left: '55%', dur: '2.6s', delay: '1.6s' },
  { w: 2, top: '30%', left: '90%', dur: '3.3s', delay: '1.1s' },
  { w: 2, top: '62%', left: '38%', dur: '2.7s', delay: '.6s' },
  { w: 3, top: '18%', left: '50%', dur: '4.2s', delay: '2.3s' },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doLogin = async () => {
    setError('');
    if (!id || !pass) { setError('Please enter both ID and password.'); return; }
    setBusy(true);
    try {
      await login(id, pass);
    } catch (e) {
      setError(e.message || 'Invalid ID or password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="loginScreen">
      {STARS.map((s, i) => (
        <div key={i} className="star" style={{ width: s.w, height: s.w, top: s.top, left: s.left, animationDuration: s.dur, animationDelay: s.delay }} />
      ))}
      {['m1', 'm2', 'm3', 'm4', 'm5'].map(m => <div key={m} className={`meteor ${m}`} />)}

      <div className="login-box">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" fill="#e8392f" width="40" height="40">
            <circle cx="12" cy="8" r="4" />
            <path d="M12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z" />
          </svg>
        </div>
        <div className="login-title">Welcome Back</div>
        <div className="login-sub">Let's run your academy smarter</div>
        {error && <div className="login-error show">⚠️ <span>{error}</span></div>}

        <div className="login-field">
          <label>Email / User ID</label>
          <div className="field-wrap">
            <span className="login-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" />
              </svg>
            </span>
            <input type="text" placeholder="Enter your email or user ID" autoComplete="off"
              value={id} onChange={e => setId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()} />
          </div>
        </div>

        <div className="login-field">
          <label>Password</label>
          <div className="field-wrap">
            <span className="login-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <input type={showPass ? 'text' : 'password'} placeholder="Enter password"
              value={pass} onChange={e => setPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()} />
            <button type="button" className="login-eye" title="Show/hide password" onClick={() => setShowPass(v => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        <button className="btn-login" onClick={doLogin} disabled={busy} style={{ cursor: 'pointer' }}>
          {busy ? 'Signing in…' : 'Sign In to Portal'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--gray)', opacity: .8 }}>
          © 2026 FeeZo Solutions · v3
        </div>
      </div>
    </div>
  );
}
