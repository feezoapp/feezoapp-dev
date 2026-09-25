import { supabase } from './supabaseClient';

// Pulls every row for this academy across all tracked tables and inserts
// it as a single JSON snapshot row. label is 'manual' (Settings button)
// or 'auto' (triggered once per day on admin login).
export async function takeSnapshot(academyId, label = 'manual') {
  const [
    academyRow, students, fees, batches, sports, enquiries,
    appUsers, attendance, attendanceDayStatus, classLog, courses,
    leaveRequests, msgLogs, achievements, weekSchedules, auditLog,
  ] = await Promise.all([
    supabase.from('academies').select('*').eq('id', academyId),
    supabase.from('students').select('*').eq('academy_id', academyId),
    supabase.from('fees').select('*').eq('academy_id', academyId),
    supabase.from('batches').select('*').eq('academy_id', academyId),
    supabase.from('sports').select('*').eq('academy_id', academyId),
    supabase.from('enquiries').select('*').eq('academy_id', academyId),
    supabase.from('app_users').select('*').eq('academy_id', academyId),
    supabase.from('attendance').select('*').eq('academy_id', academyId),
    supabase.from('attendance_day_status').select('*').eq('academy_id', academyId),
    supabase.from('class_log').select('*').eq('academy_id', academyId),
    supabase.from('courses').select('*').eq('academy_id', academyId),
    supabase.from('leave_requests').select('*').eq('academy_id', academyId),
    supabase.from('msg_logs').select('*').eq('academy_id', academyId),
    supabase.from('achievements').select('*').eq('academy_id', academyId),
    supabase.from('week_schedules').select('*').eq('academy_id', academyId),
    supabase.from('audit_log').select('*').eq('academy_id', academyId),
  ]);

  const snapKey = new Date().toISOString().slice(0, 10) + '-' + Date.now();
  const { error } = await supabase.from('snapshots').insert({
    academy_id: academyId,
    snap_key: snapKey,
    label,
    data: {
      academies: academyRow.data || [],
      students: students.data || [],
      fees: fees.data || [],
      batches: batches.data || [],
      sports: sports.data || [],
      enquiries: enquiries.data || [],
      app_users: appUsers.data || [],
      attendance: attendance.data || [],
      attendance_day_status: attendanceDayStatus.data || [],
      class_log: classLog.data || [],
      courses: courses.data || [],
      leave_requests: leaveRequests.data || [],
      msg_logs: msgLogs.data || [],
      achievements: achievements.data || [],
      week_schedules: weekSchedules.data || [],
      audit_log: auditLog.data || [],
    },
  });
  if (error) throw error;
}

// Fires at most once per calendar day per academy (IST). Checks for an
// existing 'auto' snapshot created since local midnight before creating a
// new one, so repeated logins/token refreshes in the same day are no-ops.
//
// A unique DB index (snapshots_one_auto_per_day, keyed on IST calendar day)
// is the real backstop against duplicates — this app-side check is just an
// optimization to skip the extra insert attempt most of the time. If two
// calls race and both pass this check, the DB constraint rejects the
// second insert with a 23505 (unique_violation), which is treated below
// as "already snapped today" rather than a real failure.
export async function maybeAutoSnapshot(academyId) {
  if (!academyId) return;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('snapshots')
    .select('id')
    .eq('academy_id', academyId)
    .eq('label', 'auto')
    .gte('created_at', todayStart.toISOString())
    .limit(1);

  if (error) {
    console.error('Auto snapshot check failed:', error.message);
    return;
  }
  if (data && data.length > 0) return; // already snapped today

  try {
    await takeSnapshot(academyId, 'auto');
  } catch (e) {
    // 23505 = unique_violation — a concurrent call won the race and already
    // inserted today's snapshot. That's expected, not a real failure.
    const isDuplicate = e.code === '23505' || String(e.message || '').includes('duplicate key');
    if (!isDuplicate) {
      console.error('Auto snapshot on login failed:', e.message);
    }
  }
}

// Parses a plan's features array to find the snapshot retention window.
// e.g. "snapshots_7day" -> 7, "snapshots_30day" -> 30, "snapshots_unlimited" -> null (no pruning)
export function parseRetentionDays(features) {
  if (!Array.isArray(features)) return null;
  if (features.includes('snapshots_unlimited')) return null;
  const tag = features.find(f => /^snapshots_\d+day$/.test(f));
  return tag ? parseInt(tag.match(/^snapshots_(\d+)day$/)[1], 10) : null;
}

// Deletes any snapshot (manual or auto) older than the plan's retention
// window. No-op if days is null (unlimited plan).
export async function pruneOldSnapshots(academyId, days) {
  if (days == null) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const { error } = await supabase
    .from('snapshots')
    .delete()
    .eq('academy_id', academyId)
    .lt('created_at', cutoff.toISOString());
  if (error) console.error('Snapshot pruning failed:', error.message);
}
