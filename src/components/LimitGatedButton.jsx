import { usePlan } from '../context/PlanContext';

const RESOURCE_LABELS = {
  students: 'students',
  staff: 'staff',
  sports: 'sports',
  batches: 'batches',
  batchesPerSport: 'batches per sport',
  enquiries: 'enquiries',
  classLogs: 'class log entries',
};

// Drop-in replacement for a plain "+ Add" button. Pass the resource key
// (matching PlanContext's `limits` object) and the current count of that
// resource for this academy. Once the plan's limit is hit, the button
// disables itself and an inline upgrade message appears below it.
export default function LimitGatedButton({ resource, currentCount, onClick, children, className, style }) {
  const { isAtLimit, limits, plan, nextPlanForLimit } = usePlan();
  const atLimit = isAtLimit(resource, currentCount);

  if (!atLimit) {
    return <button className={className} style={style} onClick={onClick}>{children}</button>;
  }

  const target = nextPlanForLimit(resource);
  const label = RESOURCE_LABELS[resource] || resource;

  return (
    <div>
      <button className={className} style={{ ...style, opacity: 0.5, cursor: 'not-allowed' }} disabled>
        {children}
      </button>
      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
        Limit reached ({limits[resource]} {label}) on your <strong>{plan?.name}</strong> plan.
        {target && <> Upgrade to <strong>{target.name}</strong> for more.</>}
      </div>
    </div>
  );
}
