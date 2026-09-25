import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

const CATEGORIES = [
  'Students', 'Attendance', 'Fees', 'Sports & Batches',
  'Classes', 'Queries', 'Messages', 'Users', 'Settings', 'Login / Session',
];

// Best-effort mapping of a log row to one of the display categories above,
// based on keywords in the action / description / detail text.
function categorize(l) {
  const text = `${l.action || ''} ${l.description || ''} ${l.detail || ''}`.toLowerCase();
  if (/login|session|logout/.test(text)) return 'Login / Session';
  if (/attendance/.test(text)) return 'Attendance';
  if (/\bfee/.test(text)) return 'Fees';
  if (/sport|batch/.test(text)) return 'Sports & Batches';
  if (/class/.test(text)) return 'Classes';
  if (/quer/.test(text)) return 'Queries';
  if (/message/.test(text)) return 'Messages';
  if (/\buser\b|staff/.test(text)) return 'Users';
  if (/setting/.test(text)) return 'Settings';
  if (/student|perf|mark/.test(text)) return 'Students';
  return 'Other';
}

export default function ActivityPage() {
  const { academyId, isAdmin, appUser } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userNames, setUserNames] = useState({}); // login_id -> name, for legacy rows
  const [adminIdentities, setAdminIdentities] = useState(new Set()); // ids/names/login_ids of admin users

  const [catOpen, setCatOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [roleTab, setRoleTab] = useState('admin'); // 'admin' | 'staff'

  useEffect(() => {
    (async () => {
      if (!academyId) return;
      setLoading(true);
      const { data } = await supabase.from('audit_log').select('*')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false })
        .limit(200);
      let rows = data || [];

      // Legacy rows (written by the old HTML app) store the actor as
      // `user_id` (their login_id), not `actor_name`/`actor_id`. Resolve
      // those login_ids to display names in one batch lookup. Also pull
      // `role` for every academy user so we can split Admin vs Staff.
      const { data: users } = await supabase.from('app_users')
        .select('id, login_id, name, role')
        .eq('academy_id', academyId);

      const nameMap = {};
      const adminSet = new Set();
      (users || []).forEach(u => {
        nameMap[u.login_id] = u.name;
        if (u.role === 'admin') {
          if (u.id) adminSet.add(u.id);
          if (u.name) adminSet.add(u.name);
          if (u.login_id) adminSet.add(u.login_id);
        }
      });
      setUserNames(nameMap);
      setAdminIdentities(adminSet);

      if (!isAdmin) {
        // Staff only ever see their own activity. New rows store the actor's
        // display name directly in `user_id`; true-legacy rows store their
        // login_id there instead — match against either.
        rows = rows.filter(l => {
          if (l.actor_id) return l.actor_id === appUser?.id;
          if (l.actor_name) return l.actor_name === appUser?.name;
          if (l.user_id) return l.user_id === appUser?.name || l.user_id === appUser?.login_id;
          return false;
        });
      }
      setLogs(rows);
      setLoading(false);
    })();
  }, [academyId, isAdmin, appUser]);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const whoFor = (l) => {
    const resolved = l.actor_name || (l.user_id && userNames[l.user_id]) || l.user_id;
    if (!resolved || UUID_RE.test(resolved)) return 'Unknown';
    return resolved;
  };
  // New-app rows store the full message in `description`; legacy rows store
  // it in `detail` (their `action` is just a short category like "attendance").
  const whatFor = (l) => l.description || l.detail || l.action || '—';

  const isAdminActor = (l) => {
    if (l.actor_id && adminIdentities.has(l.actor_id)) return true;
    if (l.actor_name && adminIdentities.has(l.actor_name)) return true;
    if (l.user_id && adminIdentities.has(l.user_id)) return true;
    return false;
  };

  const toggleCategory = (cat) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Logs after the category filter (but before the Admin/Staff split) —
  // used both for display and for the tab counts.
  const categoryFilteredLogs = useMemo(() => {
    if (selectedCategories.size === 0) return logs;
    return logs.filter(l => selectedCategories.has(categorize(l)));
  }, [logs, selectedCategories]);

  const adminCount = useMemo(
    () => categoryFilteredLogs.filter(isAdminActor).length,
    [categoryFilteredLogs, adminIdentities]
  );
  const staffCount = categoryFilteredLogs.length - adminCount;

  const displayLogs = useMemo(() => {
    if (!isAdmin) return categoryFilteredLogs; // staff already scoped to their own rows
    return categoryFilteredLogs.filter(l => (roleTab === 'admin' ? isAdminActor(l) : !isAdminActor(l)));
  }, [categoryFilteredLogs, roleTab, isAdmin, adminIdentities]);

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('Activity Log', 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [['Who', 'What', 'When']],
      body: displayLogs.map(l => [whoFor(l), whatFor(l), new Date(l.created_at).toLocaleString()]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 30] },
    });
    doc.save(`activity-log-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportExcel = () => {
    const rows = displayLogs.map(l => ({
      Who: whoFor(l),
      What: whatFor(l),
      Category: categorize(l),
      When: new Date(l.created_at).toLocaleString(),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activity');
    XLSX.writeFile(wb, `activity-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingBottom: 90 }}>
      <Link to="/profile" style={{ fontSize: 12, color: 'var(--accent2)', marginBottom: 10, display: 'inline-block' }}>← Back to Profile</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>📋 Activity Log</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setCatOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px',
              borderRadius: 8, border: '1px solid var(--border, #ddd)', background: '#fff',
              fontWeight: 600, fontSize: 11, cursor: 'pointer',
            }}
          >
            Categories{selectedCategories.size > 0 ? ` (${selectedCategories.size})` : ''} {catOpen ? '▲' : '▼'}
          </button>
          <button
            type="button"
            onClick={exportPDF}
            disabled={displayLogs.length === 0}
            title="Download PDF"
            style={{
              padding: '5px 10px', borderRadius: 8, border: 'none',
              background: '#111', color: '#fff', fontWeight: 700, fontSize: 11,
              cursor: displayLogs.length === 0 ? 'not-allowed' : 'pointer',
              opacity: displayLogs.length === 0 ? 0.5 : 1,
            }}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={displayLogs.length === 0}
            title="Download Excel"
            style={{
              padding: '5px 10px', borderRadius: 8, border: 'none',
              background: '#1a9e56', color: '#fff', fontWeight: 700, fontSize: 11,
              cursor: displayLogs.length === 0 ? 'not-allowed' : 'pointer',
              opacity: displayLogs.length === 0 ? 0.5 : 1,
            }}
          >
            XL
          </button>
        </div>
      </div>

      {catOpen && (
        <div style={{
          border: '1px solid var(--border, #e5e5e5)', borderRadius: 14, padding: 14,
          marginBottom: 14, background: '#fafafa',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {CATEGORIES.map(cat => (
              <label
                key={cat}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
                  border: '1px solid var(--border, #ddd)', borderRadius: 8, background: '#fff',
                  fontWeight: 600, fontSize: 12, cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.has(cat)}
                  onChange={() => toggleCategory(cat)}
                  style={{ width: 14, height: 14 }}
                />
                {cat}
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setSelectedCategories(new Set())}
              style={{
                padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border, #ddd)',
                background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setCatOpen(false)}
              style={{
                padding: '7px 10px', borderRadius: 8, border: 'none',
                background: 'var(--accent2)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setRoleTab('admin')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12,
              cursor: 'pointer',
              background: roleTab === 'admin' ? 'var(--accent2)' : '#eef0f4',
              color: roleTab === 'admin' ? '#fff' : '#333',
            }}
          >
            🔑 Admin ({adminCount})
          </button>
          <button
            type="button"
            onClick={() => setRoleTab('staff')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12,
              cursor: 'pointer',
              background: roleTab === 'staff' ? 'var(--accent2)' : '#eef0f4',
              color: roleTab === 'staff' ? '#fff' : '#333',
            }}
          >
            👤 Staff ({staffCount})
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 20, fontSize: 12 }}>Loading…</div>}

      {!loading && displayLogs.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30 }}>No activity recorded.</div>
      )}

      {!loading && displayLogs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>What</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {displayLogs.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{whoFor(l)}</td>
                  <td>{whatFor(l)}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--gray)', fontSize: 12 }}>{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
