// Roll numbers default to: (Sport first letter)(Batch first letter) + 2-digit sequence.
// e.g. Silambam + Morning Batch -> "SM01", next one in that sport+batch -> "SM02".

export function rollPrefix(sportName, batchLabel) {
  const s = (sportName || '').trim().charAt(0) || 'X';
  const b = (batchLabel || '').trim().charAt(0) || 'X';
  return (s + b).toUpperCase();
}

// existingRollNumbers: array of roll_no strings already in use (any sport/batch is fine,
// we filter by prefix internally). Returns the next available roll number for the prefix.
export function nextRollNumber(prefix, existingRollNumbers = []) {
  const nums = existingRollNumbers
    .filter(r => typeof r === 'string' && r.toUpperCase().startsWith(prefix))
    .map(r => parseInt(r.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(2, '0');
}

export function generateRollNumber(sportName, batchLabel, existingRollNumbers = []) {
  return nextRollNumber(rollPrefix(sportName, batchLabel), existingRollNumbers);
}

// Returns a batch of N sequential roll numbers for the same prefix, useful for bulk edit.
export function nextRollNumbers(prefix, existingRollNumbers = [], count = 1) {
  const nums = existingRollNumbers
    .filter(r => typeof r === 'string' && r.toUpperCase().startsWith(prefix))
    .map(r => parseInt(r.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  let next = nums.length ? Math.max(...nums) + 1 : 1;
  const out = [];
  for (let i = 0; i < count; i++) out.push(prefix + String(next + i).padStart(2, '0'));
  return out;
}
