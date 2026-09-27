import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';

// Small line-style action icons — kept intentionally simple (no icon
// library) so the detail pages never fall back to emoji for Close /
// Download / Call, matching the hand-drawn Fees/Pending/Students SVGs
// used everywhere else in the app.
function CloseIcon({ size = 13, color = '#6b7385' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.3" strokeLinecap="round">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function DownloadIcon({ size = 14, color = '#6b7385' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11" />
      <path d="M7.5 11L12 15.5 16.5 11" />
      <path d="M4 18.5h16" />
    </svg>
  );
}

function PhoneIcon({ size = 13, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h3l2 5-2.3 1.4a11.2 11.2 0 0 0 5.4 5.4L14.6 14l5 2v3a2 2 0 0 1-2.1 2A16.2 16.2 0 0 1 3 6.1 2 2 0 0 1 5 4z" />
    </svg>
  );
}

const BADGE_STYLES = {
  amber: { color: '#a3660a', background: 'rgba(230,160,20,0.14)' },
  blue: { color: '#3454a0', background: 'rgba(91,124,196,0.14)' },
  green: { color: '#1f8f6e', background: 'rgba(54,184,156,0.14)' },
  gray: { color: '#6b7385', background: 'rgba(107,115,133,0.12)' },
};

// Wraps a CSV field in quotes and escapes internal quotes only when the
// value actually needs it (contains a comma, quote, or newline) — keeps
// plain values readable while staying safe for names with commas etc.
function csvCell(val) {
  const s = (val === undefined || val === null) ? '' : String(val).replace(/₹/g, 'Rs.');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(header, dataRows) {
  const lines = [header.map(csvCell).join(',')];
  for (const r of dataRows) lines.push(r.map(csvCell).join(','));
  return lines.join('\n');
}

function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sortBtnStyle(active) {
  return {
    fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7,
    border: '1px solid var(--border)', cursor: 'pointer',
    background: active ? 'var(--accent2)' : 'var(--card2)',
    color: active ? '#fff' : 'var(--gray)',
  };
}

// One shared bottom-sheet detail page for all three dashboard stat cards
// (Total Students / Fees Collected / Fee Pending). Callers normalize their
// data into a flat `items` array + a `summary` chip list up front, so this
// component only has one rendering path instead of branching per stat.
//
// item shape: { id, name, contact, sport, batchLabel, school,
//               amountLabel?, monthLabel?, badge?, badgeTone? }
// summary shape: [{ label, value }]
export default function StatDrilldownModal({ type, title, icon, filters, summary = [], items = [], showContact = true, canExport = true, onClose }) {
  const [sortDir, setSortDir] = useState('asc');
  // Which summary chip is currently narrowing the list (e.g. "Joined" /
  // "Dropped" on the Total Students page). null = no filter, show everything.
  const [activeFilter, setActiveFilter] = useState(null);

  // Sorting by month only makes sense when a page can show more than one
  // month at once — every row here is already scoped to the same browsed
  // month, so the Month sort is dead weight and is left off entirely.
  const hasMonth = type !== 'students';

  const filteredItems = useMemo(() => (
    activeFilter == null ? items : items.filter(it => it.badge === activeFilter)
  ), [items, activeFilter]);

  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortDir]);

  const toggleSort = () => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));

  const handleExport = () => {
    const header = ['Name', ...(showContact ? ['Contact'] : []), 'Sport', 'Batch', 'School',
      ...(hasMonth ? ['Amount', 'Month'] : ['Status'])];
    const dataRows = sortedItems.map(it => [
      it.name || '', ...(showContact ? [it.contact || ''] : []),
      it.sport || '', it.batchLabel || '', it.school || '',
      ...(hasMonth ? [it.amountLabel || '', it.monthLabel || ''] : [it.badge || '']),
    ]);
    const csv = rowsToCsv(header, dataRows);
    const safeTitle = (title || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    downloadCsv(`${safeTitle}.csv`, csv);
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--card)', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '86vh', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)' }}>

        {/* Header: icon + title + student count, filter chip, close/export */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#1A336A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--gray)', fontWeight: 600, marginTop: 1 }}>
                  {filteredItems.length} student{filteredItems.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {items.length > 0 && canExport && (
                <button onClick={handleExport} aria-label="Download CSV" title="Download CSV"
                  style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DownloadIcon size={14} color="#6b7385" />
                </button>
              )}
              <button onClick={onClose} aria-label="Close"
                style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--card2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CloseIcon size={13} color="#6b7385" />
              </button>
            </div>
          </div>

          {filters && (
            <div style={{
              marginTop: 10, fontSize: 11.5, fontWeight: 700, color: '#5b7cc4',
              background: 'rgba(91,124,196,.1)', display: 'inline-block', padding: '4px 10px', borderRadius: 8,
            }}>
              {filters.monthLabel} · {filters.sportLabel} · {filters.batchLabel}
            </div>
          )}
        </div>

        {/* Summary chips — different set per stat type, passed in by the caller.
            A chip with clickable:true narrows the list below to items whose
            badge matches its filterBadge (null = clear filter / show all). */}
        {summary.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(summary.length, 4)}, 1fr)`, gap: 8, padding: '12px 14px 0', flexShrink: 0 }}>
            {summary.map((s, i) => {
              const isClickable = !!s.clickable;
              const chipValue = s.filterBadge ?? null;
              const isActive = isClickable && activeFilter === chipValue;
              return (
                <div
                  key={i}
                  onClick={isClickable ? () => setActiveFilter(prev => (prev === chipValue ? null : chipValue)) : undefined}
                  style={{
                    background: isActive ? '#1A336A' : 'var(--card2)',
                    border: '1px solid var(--border)', borderRadius: 10, padding: '10px 6px', textAlign: 'center',
                    cursor: isClickable ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 60, boxSizing: 'border-box',
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 800, color: isActive ? '#fff' : '#1A336A', lineHeight: 1.15, wordBreak: 'break-word' }}>{s.value}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: isActive ? 'rgba(255,255,255,.75)' : 'var(--gray)', marginTop: 3, textTransform: 'uppercase', letterSpacing: .3 }}>{s.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {filteredItems.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '10px 14px 0', flexShrink: 0 }}>
            <button onClick={toggleSort} style={sortBtnStyle(true)}>
              Name {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {sortedItems.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--gray)', padding: 30, fontSize: 13 }}>No students in this category.</div>
          )}

          {sortedItems.map((it, i) => (
            <div key={it.id || i} className="card" style={{
              display: 'flex', flexDirection: 'column', gap: 6, padding: '13px 14px', marginBottom: 9,
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 14.5, flex: 1, minWidth: 0, overflowWrap: 'break-word', color: '#182238' }}>{it.name}</div>
                {it.badge && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0, ...BADGE_STYLES[it.badgeTone || 'gray'] }}>
                    {it.badge}
                  </span>
                )}
              </div>

              {(it.sport || it.school) && (
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--gray)', overflowWrap: 'break-word', lineHeight: 1.4 }}>
                  {[it.sport, it.batchLabel, it.school].filter(Boolean).join(' · ')}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 6, marginTop: 3 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1A336A', minWidth: 0, overflowWrap: 'break-word' }}>
                  {[it.amountLabel, it.monthLabel].filter(Boolean).join(' · ') || '\u00A0'}
                </div>
                {showContact ? (
                  it.contact ? (
                    <a href={`tel:${it.contact}`} onClick={e => e.stopPropagation()}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#1A336A', color: '#fff',
                        borderRadius: 8, padding: '0 12px', minHeight: 44, minWidth: 44, fontSize: 12, fontWeight: 700,
                        textDecoration: 'none', flexShrink: 0, marginLeft: 'auto',
                      }}>
                      <PhoneIcon size={13} color="#fff" /> {it.contact}
                    </a>
                  ) : (
                    <span style={{ fontSize: 10.5, color: 'var(--gray)', flexShrink: 0 }}>No contact</span>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
