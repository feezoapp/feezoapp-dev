import { useState } from 'react';
import { usePlan } from '../context/PlanContext';

// Wrap any tab/section with a `feature` key matching a `has_*` column on
// `plans` (e.g. "has_performance"). If the academy's plan doesn't include
// it, the content renders blurred and non-interactive; tapping it shows
// which plan is needed. While the plan is still loading, children render
// normally to avoid a flash of the locked state.
export default function UpgradeGate({ feature, children }) {
  const { hasFeature, plan, cheapestPlanWithFeature, featureLabels, loading } = usePlan();
  const [showModal, setShowModal] = useState(false);

  if (loading) return children;
  if (hasFeature(feature)) return children;

  const targetPlan = cheapestPlanWithFeature(feature);
  const label = featureLabels[feature] || feature;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">
        {children}
      </div>
      <div
        style={{ position: 'absolute', inset: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setShowModal(true)}
      >
        <div style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          🔒 Upgrade to unlock {label}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay active" style={{ alignItems: 'center', padding: 16 }} onClick={() => setShowModal(false)}>
          <div className="modal" style={{ borderRadius: 18, maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {label} is locked
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div style={{ padding: '4px 4px 14px', fontSize: 13, lineHeight: 1.6 }}>
              Your current plan is <strong>{plan?.name || 'Unknown'}</strong>, which doesn't include {label}.
              {targetPlan ? (
                <> Upgrade to <strong>{targetPlan.name}</strong> to unlock it.</>
              ) : (
                <> Contact us to find a plan that includes it.</>
              )}
            </div>
            <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} onClick={() => setShowModal(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
