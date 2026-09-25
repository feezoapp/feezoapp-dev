import { usePlan } from '../context/PlanContext';

// Wraps a page/route and only renders its children if the current academy's
// plan includes the given `has_*` feature flag. Otherwise shows a locked-out
// state with an upgrade nudge (using the same plan data EnquiryTab already
// reads from PlanContext — no new plumbing needed).
//
// Usage:
//   <FeatureGate feature="has_performance">
//     <PerformancePageContent />
//   </FeatureGate>
export default function FeatureGate({ feature, children }) {
  const { hasFeature, cheapestPlanWithFeature, plan, featureLabels, loading } = usePlan();

  // Avoid flashing the locked state before the plan has loaded at all
  if (loading) return null;

  if (hasFeature(feature)) return children;

  const label = featureLabels[feature] || 'This feature';
  const target = cheapestPlanWithFeature(feature);

  return (
    <div
      className="page active"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '60px 24px',
        gap: 10,
        minHeight: '50vh',
      }}
    >
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--offwhite)' }}>
        {label} isn't on your plan
      </div>
      <div style={{ fontSize: 13, color: 'var(--gray)', maxWidth: 280, lineHeight: 1.5 }}>
        {plan?.name ? (
          <>Your <strong>{plan.name}</strong> plan doesn't include this.</>
        ) : (
          "This feature isn't included on your current plan."
        )}
        {target && (
          <> Upgrade to <strong>{target.name}</strong> to unlock it.</>
        )}
      </div>
    </div>
  );
}
