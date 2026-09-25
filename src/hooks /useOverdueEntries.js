import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAcademyData } from '../context/AcademyDataContext';
import { supabase } from '../lib/supabaseClient';
import { isOverdue } from '../lib/scheduleUtils';

// Polls periodically (and on mount) for whether any enrolled student has a
// program entry more than 1 day overdue — drives the bell's red dot.
export default function useOverdueEntries() {
  const { academyId } = useAuth();
  const { visibleStudents } = useAcademyData();
  const [hasOverdue, setHasOverdue] = useState(false);

  useEffect(() => {
    if (!academyId) return;
    let cancelled = false;

    const check = async () => {
      const [progRes, chalRes, ptsRes] = await Promise.all([
        supabase.from('programs').select('id, sport, frequency, created_at').eq('academy_id', academyId),
        supabase.from('program_challenges').select('id, program_id, sport').eq('academy_id', academyId),
        supabase.from('student_challenge_points').select('student_id, challenge_id, awarded_at, created_at').eq('academy_id', academyId),
      ]);
      if (cancelled) return;
      const programs = progRes.data || [];
      const challenges = chalRes.data || [];
      const pointsRows = ptsRes.data || [];

      const challengeToProgram = {};
      challenges.forEach(c => { challengeToProgram[c.id] = c.program_id; });

      // last entry date per student+program
      const lastEntryByStudentProgram = {};
      pointsRows.forEach(p => {
        const programId = challengeToProgram[p.challenge_id];
        if (!programId) return;
        const key = `${p.student_id}|${programId}`;
        const date = p.awarded_at || p.created_at;
        if (!lastEntryByStudentProgram[key] || new Date(date) > new Date(lastEntryByStudentProgram[key])) {
          lastEntryByStudentProgram[key] = date;
        }
      });

      let found = false;
      outer:
      for (const student of visibleStudents) {
        const sports = new Set((student.enrollments || []).map(e => e.sport));
        for (const program of programs) {
          if (!sports.has(program.sport)) continue;
          const hasChallenges = challenges.some(c => c.program_id === program.id);
          if (!hasChallenges) continue;
          const key = `${student.id}|${program.id}`;
          if (isOverdue(program, lastEntryByStudentProgram[key])) {
            found = true;
            break outer;
          }
        }
      }
      setHasOverdue(found);
    };

    check();
    const interval = setInterval(check, 5 * 60 * 1000); // re-check every 5 min
    return () => { cancelled = true; clearInterval(interval); };
  }, [academyId, visibleStudents]);

  return hasOverdue;
}
