// Store contact numbers as a plain 10-digit string, stripping +91 / 91 / spaces / dashes.
export function normalizePhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, ''); // strip everything but digits
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function isValidPhone(raw) {
  const digits = normalizePhone(raw);
  return digits.length === 10;
}
