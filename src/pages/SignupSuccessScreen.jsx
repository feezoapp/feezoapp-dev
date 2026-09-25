import { useNavigate, useLocation } from 'react-router-dom';
import AuthBackdrop from '../components/AuthBackdrop';

export default function SignupSuccessScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const academyName = location.state?.academyName;

  return (
    <div id="loginScreen">
      <AuthBackdrop />
      <div className="login-box" style={{ textAlign: 'center' }}>
        <div className="login-logo" style={{ display: 'flex', justifyContent: 'center' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="2" width="52" height="52">
            <circle cx="12" cy="12" r="10" />
            <path d="m8 12 3 3 5-6" />
          </svg>
        </div>
        <div className="login-title">Academy created!</div>
        <div className="login-sub">
          {academyName ? <>“{academyName}” is ready. </> : null}
          You can now log in with your academy username and password.
        </div>

        <button className="btn-login" onClick={() => navigate('/login', { replace: true })} style={{ cursor: 'pointer', marginTop: 8 }}>
          Go to Login
        </button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--gray)', opacity: .8 }}>
          © 2026 FeeZo Solutions · v3
        </div>
      </div>
    </div>
  );
}
