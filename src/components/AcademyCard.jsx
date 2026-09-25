import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';

// Downscale + square-crop an uploaded image client-side (no interactive
// cropper, but keeps the stored data URL small instead of the raw upload).
function resizeToDataUrl(file, size = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function AcademyCard() {
  const { isAdmin } = useAuth();
  const { academy, refreshAcademy } = useAcademyData();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!academy) return;
    setLogoUrl(academy.logo_url || '');
    setName(academy.name || '');
    setEmail(academy.email || '');
    setPhone(academy.phone || '');
    setPhone2(academy.phone2 || '');
  }, [academy]);

  const onPickLogo = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeToDataUrl(file);
      setLogoUrl(dataUrl);
    } catch {
      alert('Could not read that image.');
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('academies').update({
      name: name.trim(), logo_url: logoUrl, email: email.trim(), phone: phone.trim(),
      phone2: phone2.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', academy.id);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    await refreshAcademy();
    setEditing(false);
  };

  if (!academy) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="logo-img" style={{ width: 60, height: 60, fontSize: 26, flexShrink: 0, overflow: 'hidden' }}>
          {academy.logo_url ? <img src={academy.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '⚔️'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{academy.name || 'Academy'}</div>
          {academy.email && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{academy.email}</div>}
          {academy.phone && <div style={{ fontSize: 12, color: 'var(--gray)' }}>{academy.phone}</div>}
          {academy.phone2 && <div style={{ fontSize: 12, color: 'var(--gray)' }}>{academy.phone2}</div>}
        </div>
        {isAdmin && !editing && (
          <button style={{ flexShrink: 0, background: 'var(--accent2)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            onClick={() => setEditing(true)}>✏️ Edit</button>
        )}
      </div>

      {isAdmin && editing && (
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 1, background: 'var(--border)', marginBottom: 12 }} />

          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>🖼️ Academy Logo</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div className="logo-img" style={{ width: 52, height: 52, fontSize: 22, flexShrink: 0, overflow: 'hidden' }}>
              {logoUrl ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '⚔️'}
            </div>
            <label
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--card2)', border: '1.5px dashed var(--accent2)', borderRadius: 8, padding: 11, fontSize: 13, color: 'var(--gold)', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => fileRef.current?.click()}
            >📂 Change Logo</label>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickLogo} />
          </div>

          <div className="form-group">
            <label className="form-label">Academy Name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Academy name" />
          </div>
          <div className="form-row" style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Email</label>
              <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Phone</label>
              <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 XXXXX" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Alternate Phone <span style={{ fontSize: 10, color: 'var(--gray)' }}>(optional)</span></label>
            <input className="form-input" value={phone2} onChange={e => setPhone2(e.target.value)} placeholder="+91 XXXXX" />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(false)}>✕ Close</button>
            <button className="btn btn-primary" style={{ flex: 2, padding: 11 }} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
