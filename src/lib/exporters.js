import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

function calcAge(dobIso) {
  if (!dobIso) return '';
  const d = new Date(dobIso);
  if (isNaN(d)) return '';
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function calcBMI(heightCm, weightKg) {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return '';
  const m = h / 100;
  return (w / (m * m)).toFixed(1);
}

// jsPDF's addImage needs a base64 data URL, not a plain image URL — fetch the
// logo and convert it. Returns null (rather than throwing) on any failure so
// a broken/missing logo never blocks the rest of the PDF from generating.
async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
    return { dataUrl, format };
  } catch {
    return null;
  }
}

// canViewContact gates the phone number columns, matching the same permission
// used in the Students list / detail view — staff without contact access
// shouldn't be able to get phone numbers via export either.
// achievementsByStudent: { [studentId]: Array<{event_name, level, result, achievement_date}> }
function achievementSummary(list) {
  if (!list || list.length === 0) return '';
  return list.map(a => {
    const bits = [a.event_name, a.result, a.level, a.achievement_date].filter(Boolean);
    return bits.join(' - ');
  }).join('; ');
}

// Multiple sport/batch enrollments are joined into one cell as "Sport (Batch), ..."
// rather than dropped to just the primary one.
function enrollmentSummary(student) {
  const list = student.enrollments;
  if (list && list.length > 0) return list.map(en => `${en.sport} (${en.batchLabel})`).join(', ');
  return student.sport ? `${student.sport} (${student.batchLabel || ''})` : '';
}

export function exportStudentsPdf(students, canViewContact = true, achievementsByStudent = {}) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.text('Student List', 14, 14);
  const head = ['Roll No', 'Name', 'Sport (Batch)', 'DOB', 'Age', 'Gender', 'Height', 'Weight', 'BMI', 'Parent/Guardian'];
  if (canViewContact) head.push('Contact 1', 'Contact 2');
  head.push('School', 'Joined', 'Status', 'Achievements');
  autoTable(doc, {
    startY: 20,
    styles: { fontSize: 8 },
    columnStyles: { [head.length - 1]: { cellWidth: 50 } },
    head: [head],
    body: students.map(s => {
      const row = [
        s.roll_no || '', s.name || '', enrollmentSummary(s),
        s.dob || '', s.dob ? '' : (s.age || ''), s.gender || '',
        s.height ? `${s.height} cm` : '', s.weight ? `${s.weight} kg` : '', calcBMI(s.height, s.weight),
        s.parent || '',
      ];
      if (canViewContact) row.push(s.contact || '', s.contact2 || '');
      row.push(s.address || '', s.join_date || '', s.banned ? 'Dropout' : 'Active');
      row.push(achievementSummary(achievementsByStudent[s.id]));
      return row;
    }),
  });
  doc.save('students.pdf');
}

export function exportStudentsXlsx(students, canViewContact = true, achievementsByStudent = {}) {
  const ws = XLSX.utils.json_to_sheet(students.map(s => {
    const row = {
      RollNo: s.roll_no || '', Name: s.name || '', SportBatch: enrollmentSummary(s),
      DOB: s.dob || '', Age: s.dob ? '' : (s.age || ''), Gender: s.gender || '',
      Height_cm: s.height || '', Weight_kg: s.weight || '', BMI: calcBMI(s.height, s.weight),
      Parent: s.parent || '',
    };
    if (canViewContact) { row.Contact = s.contact || ''; row.Contact2 = s.contact2 || ''; }
    row.School = s.address || '';
    row.JoinDate = s.join_date || '';
    row.Status = s.banned ? 'Dropout' : 'Active';
    const list = achievementsByStudent[s.id] || [];
    row.AchievementCount = list.length;
    row.Achievements = achievementSummary(list);
    return row;
  }));
  ws['!cols'] = [
    { wch: 10 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 6 }, { wch: 9 },
    { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 18 },
    ...(canViewContact ? [{ wch: 13 }, { wch: 13 }] : []),
    { wch: 20 }, { wch: 12 }, { wch: 9 }, { wch: 10 }, { wch: 50 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'students.xlsx');
}

export function exportGenericXlsx(rows, filename, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function exportGenericPdf(title, columns, rows, filename) {
  const doc = new jsPDF();
  doc.text(title, 14, 14);
  autoTable(doc, { startY: 20, head: [columns], body: rows });
  doc.save(filename);
}

// Single-student profile export — a letterhead-style PDF with the academy's
// name/logo pulled from the `academies` row, matching the same permission
// gating (canViewContact) used in the Students list and detail view.
export async function exportStudentProfilePdf(student, academy = {}, achievements = [], canViewContact = true) {
  const doc = new jsPDF(); // portrait, A4
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  // ---- Letterhead ----
  const logo = await urlToDataUrl(academy.logo_url);
  if (logo) {
    doc.addImage(logo.dataUrl, logo.format, 14, y, 20, 20);
    doc.setFontSize(16).setFont(undefined, 'bold');
    doc.text(academy.name || 'Academy', 40, y + 9);
    doc.setFontSize(10).setFont(undefined, 'normal');
    doc.text('Student Profile Report', 40, y + 16);
    y += 26;
  } else {
    doc.setFontSize(18).setFont(undefined, 'bold');
    doc.text(academy.name || 'Academy', pageWidth / 2, y + 6, { align: 'center' });
    doc.setFontSize(10).setFont(undefined, 'normal');
    doc.text('Student Profile Report', pageWidth / 2, y + 13, { align: 'center' });
    y += 22;
  }
  doc.setDrawColor(180).line(14, y, pageWidth - 14, y);
  y += 8;

  // ---- Name + Roll banner ----
  doc.setFontSize(14).setFont(undefined, 'bold');
  doc.text(student.name || '', 14, y);
  doc.setFontSize(11).setFont(undefined, 'normal');
  doc.text(`Roll No: ${student.roll_no || '-'}`, pageWidth - 14, y, { align: 'right' });
  y += 6;
  if (student.banned) {
    doc.setTextColor(200, 0, 0).text('Status: Dropout', 14, y);
    doc.setTextColor(0);
    y += 6;
  }
  y += 4;

  // ---- Personal Info ----
  const age = student.dob ? calcAge(student.dob) : student.age;
  const bmi = student.bmi || calcBMI(student.height, student.weight); // fall back to live calc for older rows saved before bmi was stored
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    body: [
      ['Date of Birth', student.dob || '-', 'Age', age || '-'],
      ['Gender', student.gender || '-', 'Height', student.height ? `${student.height} cm` : '-'],
      ['Weight', student.weight ? `${student.weight} kg` : '-', 'BMI', bmi || '-'],
    ],
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ---- Guardian & Contact ----
  const guardianRows = [['Parent / Guardian', student.parent || '-']];
  if (canViewContact) {
    guardianRows.push(['Contact 1', student.contact || '-']);
    if (student.contact2) guardianRows.push(['Contact 2', student.contact2]);
  }
  guardianRows.push(['School', student.address || '-'], ['Joined', student.join_date || '-']);
  autoTable(doc, {
    startY: y, theme: 'plain', styles: { fontSize: 10, cellPadding: 2 },
    body: guardianRows,
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ---- Sports Enrolled ----
  if (student.enrollments?.length) {
    doc.setFontSize(11).setFont(undefined, 'bold').text('Sports Enrolled', 14, y);
    y += 4;
    autoTable(doc, {
      startY: y, head: [['Sport', 'Batch']], styles: { fontSize: 9 },
      body: student.enrollments.map(en => [en.sport || '-', en.batchLabel || '-']),
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ---- Achievements ----
  if (achievements.length) {
    doc.setFontSize(11).setFont(undefined, 'bold').text('Achievements', 14, y);
    y += 4;
    autoTable(doc, {
      startY: y, head: [['Event', 'Level', 'Result', 'Date']], styles: { fontSize: 9 },
      body: achievements.map(a => [a.event_name || '-', a.level || '-', a.result || '-', a.achievement_date || '-']),
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ---- Footer ----
  doc.setFontSize(8).setTextColor(140);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, doc.internal.pageSize.getHeight() - 10);

  doc.save(`${(student.name || 'student').replace(/\s+/g, '_')}_profile.pdf`);
}
