import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import AuthBackdrop from '../components/AuthBackdrop';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const [academyName, setAcademyName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // contactNumber only ever holds digits typed after the fixed +91 prefix,
  // capped at 10 by the input's onChange handler — so it IS the 10-digit
  // number already, no stripping needed here.
  const digitsOnly = contactNumber;

  const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const doSubmit = async () => {
    setError('');

    if (!academyName.trim()) { setError('Please enter your academy name.'); return; }
    if (academyName.trim().length < 3) { setError('Academy name should be at least 3 characters.'); return; }

    if (!trimmedEmail) { setError('Please enter a contact email address.'); return; }
    if (!EMAIL_RE.test(trimmedEmail)) { setError('Please enter a valid email address.'); return; }

    if (digitsOnly.length < 10) { setError('Please enter a valid 10-digit contact number.'); return; }

    setBusy(true);
    try {
      const { error: insertError } = await supabase.from('academy_signup_requests').insert({
        academy_name: academyName.trim(),
        contact_email: trimmedEmail,
        contact_phone: digitsOnly,
      });
      if (insertError) throw insertError;

      setSubmitted(true);
    } catch (e) {
      setError(e.message || 'Something went wrong submitting your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div id="loginScreen" className="signup-compact">
        <AuthBackdrop />
        <div className="login-box" style={{ textAlign: 'center' }}>
          <div className="login-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="2" width="44" height="44">
              <circle cx="12" cy="12" r="10" />
              <path d="m8 12 3 3 5-6" />
            </svg>
          </div>
          <div className="login-title">Request received</div>
          <div className="login-sub" style={{ marginBottom: 4 }}>
            Thanks for your interest — our team will review your details and reach out shortly to get your academy set up.
          </div>
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13 }}>
            <span style={{ color: 'var(--gray)' }}>Already have an academy? </span>
            <Link to="/login" style={{ color: '#e8392f', fontWeight: 600, textDecoration: 'none' }}>Log in</Link>
          </div>
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--gray)', opacity: .8 }}>
            © 2026 FeeZo Solutions · v3
          </div>
        </div>
        <style>{`
          .signup-compact .login-box { padding-top: 22px; padding-bottom: 22px; }
          .signup-compact .login-title { font-size: 19px; margin-top: 6px; }
          .signup-compact .login-sub { font-size: 12px; margin-bottom: 14px; }
        `}</style>
      </div>
    );
  }

  return (
    <div id="loginScreen" className="signup-compact">
      <AuthBackdrop />
      <div className="login-box">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" fill="#e8392f" width="40" height="40">
            <circle cx="12" cy="8" r="4" />
            <path d="M12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z" />
          </svg>
        </div>
        <div className="login-title">Request your academy</div>
        <div className="login-sub">Tell us a bit about your academy and our team will set up your account</div>
        {error && <div className="login-error show">⚠️ <span>{error}</span></div>}

        <div className="login-field">
          <label>Academy name</label>
          <div className="field-wrap">
            <span className="login-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M14 9h1M14 13h1M9 21v-4h6v4" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="e.g. Sunrise Sports Academy"
              autoComplete="off"
              value={academyName}
              onChange={e => setAcademyName(e.target.value)}
            />
          </div>
        </div>

        <div className="login-field">
          <label>Contact email</label>
          <div className="field-wrap">
            <span className="login-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
              </svg>
            </span>
            <input
              type="email"
              placeholder="e.g. you@gmail.com"
              autoComplete="off"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="login-field">
          <label>Contact number</label>
          <div className="field-wrap">
            <span className="login-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="#e8392f" strokeWidth="2" width="17" height="17">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z" />
              </svg>
            </span>
            <span className="cc-prefix">+91</span>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="10-digit number"
              autoComplete="off"
              value={contactNumber}
              onChange={e => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
              maxLength={10}
              onKeyDown={e => e.key === 'Enter' && doSubmit()}
            />
          </div>
        </div>

        <button className="btn-login" onClick={doSubmit} disabled={busy} style={{ cursor: 'pointer' }}>
          {busy ? 'Submitting…' : 'Submit Request'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
          <span style={{ color: 'var(--gray)' }}>Already have an academy? </span>
          <Link to="/login" style={{ color: '#e8392f', fontWeight: 600, textDecoration: 'none' }}>Log in</Link>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--gray)', opacity: .8 }}>
          © 2026 FeeZo Solutions · v3
        </div>
      </div>

      <style>{`
        .signup-compact .login-box { padding-top: 22px; padding-bottom: 22px; }
        .signup-compact .login-title { font-size: 19px; margin-top: 6px; }
        .signup-compact .login-sub { font-size: 12px; margin-bottom: 14px; }
        .signup-compact .login-field { margin-bottom: 10px; }
        .signup-compact .login-field label { font-size: 11.5px; margin-bottom: 4px; }
        .signup-compact .field-wrap input { font-size: 12px; line-height: 1.1; padding-top: 0; padding-bottom: 0; height: 30px; }
        .signup-compact .field-wrap input::placeholder { font-size: 11.5px; }
        .signup-compact .login-ico svg { width: 12px; height: 12px; }
        .signup-compact .field-wrap { min-height: 0; }
        .signup-compact .cc-prefix { line-height: 1.1; }
        .signup-compact .btn-login { padding-top: 11px; padding-bottom: 11px; font-size: 14px; margin-top: 4px; }
        .signup-compact .cc-prefix { font-size: 13px; font-weight: 600; color: #444; padding-right: 6px; border-right: 1px solid rgba(150,150,150,.35); margin-right: 8px; }
      `}</style>
    </div>
  );
}
