// Batches are stored as a composite key "Sport::BatchName" because the same
// batch name (e.g. "Beginners") can exist under different sports.
export function parseBatchKey(raw) {
  if (!raw) return { sport: '', label: '' };
  const idx = raw.indexOf('::');
  if (idx === -1) return { sport: '', label: raw };
  return { sport: raw.slice(0, idx), label: raw.slice(idx + 2) };
}

export function buildBatchKey(sport, label) {
  return `${sport}::${label}`;
}
