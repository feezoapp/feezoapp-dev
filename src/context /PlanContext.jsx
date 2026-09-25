import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const PlanContext = createContext(null);

// Maps the friendly resource names used around the app to the actual
// column names on the `plans` table (the *_limit set, not the older max_*
// columns — see plan for why).
const LIMIT_KEY_MAP = {
  students: 'student_limit',
  staff: 'staff_limit',
  sports: 'sport_limit',
  batchesPerSport: 'batches_per_sport_limit',
  batches: 'batch_limit',
  enquiries: 'enquiry_limit',
  classLogs: 'class_log_limit',
};

const FEATURE_LABELS = {
  has_enquiry: 'Enquiries',
  has_activity: 'Activity Log',
  has_performance: 'Performance & Leaderboard',
  has_schedules: 'Staff Schedules',
  has_reports: 'Reports',
  has_bulk_import: 'Bulk Import',
  has_whatsapp: 'WhatsApp Integration',
};

export function PlanProvider({ children }) {
  const { academyId } = useAuth();
  const [academyPlanCode, setAcademyPlanCode] = useState(null);
  const [allPlans, setAllPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!academyId) { setLoading(false); return; }
      setLoading(true);
      const [{ data: academyRow }, { data: plansRows }] = await Promise.all([
        supabase.from('academies').select('plan').eq('id', academyId).maybeSingle(),
        supabase.from('plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      ]);
      if (cancelled) return;
      setAcademyPlanCode(academyRow?.plan || null);
      setAllPlans(plansRows || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [academyId]);

  const plan = useMemo(
    () => allPlans.find(p => p.code === academyPlanCode) || null,
    [allPlans, academyPlanCode]
  );

  // null/undefined on a *_limit column means unlimited for that plan.
  const limits = useMemo(() => ({
    students: plan?.student_limit ?? null,
    staff: plan?.staff_limit ?? null,
    sports: plan?.sport_limit ?? null,
    batchesPerSport: plan?.batches_per_sport_limit ?? null,
    batches: plan?.batch_limit ?? null,
    enquiries: plan?.enquiry_limit ?? null,
    classLogs: plan?.class_log_limit ?? null,
    snapshotDays: plan?.snapshot_days ?? null,
  }), [plan]);

  const isAtLimit = useCallback((resource, currentCount) => {
    const limit = limits[resource];
    if (limit === null || limit === undefined) return false;
    return currentCount >= limit;
  }, [limits]);

  const hasFeature = useCallback((key) => !!plan?.[key], [plan]);

  // Cheapest active plan (by sort_order) that includes a given has_* feature —
  // used to tell a gated-out user which plan unlocks it.
  const cheapestPlanWithFeature = useCallback((key) => {
    const candidates = allPlans
      .filter(p => !!p[key])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return candidates[0] || null;
  }, [allPlans]);

  // Cheapest active plan ranked above the current one that raises (or removes)
  // the limit for a given resource — used for "Upgrade to X for more Y" messages.
  const nextPlanForLimit = useCallback((resource) => {
    if (!plan) return null;
    const limitKey = LIMIT_KEY_MAP[resource];
    if (!limitKey) return null;
    const currentLimit = plan[limitKey];
    const candidates = allPlans
      .filter(p => (p.sort_order ?? 0) > (plan.sort_order ?? 0))
      .filter(p => p[limitKey] === null || p[limitKey] === undefined ||
        (currentLimit != null && p[limitKey] > currentLimit))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return candidates[0] || null;
  }, [plan, allPlans]);

  const value = {
    plan, allPlans, limits, loading,
    isAtLimit, hasFeature, cheapestPlanWithFeature, nextPlanForLimit,
    featureLabels: FEATURE_LABELS,
  };

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}
