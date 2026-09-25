import React from "react";
import CircularLoader from "./CircularLoader";
import { useLoading } from "./LoadingContext";

export default function GlobalLoaderOverlay() {
  const { isLoading, progress, label } = useLoading();

  if (!isLoading) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 16,
          padding: "32px 40px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
      >
        <CircularLoader progress={progress} label={label} size={110} />
      </div>
    </div>
  );
}
