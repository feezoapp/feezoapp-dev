import { supabase } from './supabaseClient';

// Best-effort activity logger. The `audit_log` table only has the columns
// from the original HTML app — user_id, role, action, detail — there is no
// actor_id/actor_name/description column, so we write into what actually
// exists. `user_id` holds the display name directly (that column is just
// text, same as the legacy app storing a login_id string in it) — admin/
// ActivityPage.jsx already falls back to showing the raw user_id when no
// name lookup matches, so this renders correctly with zero schema changes.
// Never throws — a failed audit write should never block the real action.
export async function logActivity({ academyId, actorId = null, actorName, role = '', message }) {
  try {
    const { error } = await supabase.from('audit_log').insert({
      academy_id: academyId,
      user_id: actorName || actorId || 'Unknown',
      role,
      action: message,
      detail: message,
    });
    if (error) console.error('audit_log insert failed:', error);
  } catch (e) {
    console.error('audit_log insert threw:', e);
  }
}
