import React, { useState, useEffect } from "react";

/**
 * CircularLoader
 * Props:
 *  - progress: number (0-100). If omitted, shows an indeterminate spin animation.
 *  - size: diameter in px (default 120)
 *  - label: text under the percentage (e.g. "Loading fees...")
 */
export default function CircularLoader({ progress, size = 120, label = "Loading..." }) {
  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const isIndeterminate = progress === undefined || progress === null;
  const clamped = isIndeterminate ? 0 : Math.min(100, Math.max(0, progress));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <div style={{ position: "relative", width: size, height: size }}>
        <svg
          width={size}
          height={size}
          style={{
            transform: "rotate(-90deg)",
            animation: isIndeterminate ? "loaderSpin 1.2s linear infinite" : "none",
          }}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#E5E9F0"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#loaderGradient)"
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={isIndeterminate ? circumference * 0.75 : offset}
            style={{ transition: isIndeterminate ? "none" : "stroke-dashoffset 0.4s ease" }}
          />
          <defs>
            <linearGradient id="loaderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#1E3A8A" />
            </linearGradient>
          </defs>
        </svg>

        {!isIndeterminate && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size * 0.22,
              fontWeight: 700,
              color: "#1E293B",
            }}
          >
            {Math.round(clamped)}%
          </div>
        )}
      </div>

      {label && (
        <div style={{ fontSize: 14, color: "#64748B", fontWeight: 500 }}>{label}</div>
      )}

      <style>{`
        @keyframes loaderSpin {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
      `}</style>
    </div>
  );
}

/**
 * Example usage while fetching real data with simulated progress:
 *
 * const [progress, setProgress] = useState(0);
 *
 * useEffect(() => {
 *   let p = 0;
 *   const interval = setInterval(() => {
 *     p = Math.min(p + Math.random() * 15, 90); // creep up, cap at 90%
 *     setProgress(p);
 *   }, 200);
 *
 *   fetchData().then(() => {
 *     clearInterval(interval);
 *     setProgress(100);
 *     setTimeout(() => setLoading(false), 300);
 *   });
 *
 *   return () => clearInterval(interval);
 * }, []);
 *
 * return loading ? <CircularLoader progress={progress} label="Loading students..." /> : <ActualContent />;
 */
