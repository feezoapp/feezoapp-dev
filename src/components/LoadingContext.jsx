import React, { createContext, useContext, useState, useCallback, useRef } from "react";

const LoadingContext = createContext(null);

// Loader won't appear at all if the fetch finishes before this many ms —
// avoids an annoying flash for sub-second loads.
const SHOW_DELAY_MS = 300;
// Once shown, stays visible at least this long so it doesn't flicker off
// a frame after appearing.
const MIN_VISIBLE_MS = 400;

export function LoadingProvider({ children }) {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(null); // null = indeterminate spin
  const [label, setLabel] = useState("Loading...");
  const simInterval = useRef(null);
  const showTimer = useRef(null);
  const shownAt = useRef(null);
  const pendingHide = useRef(false);

  // Show loader. If you don't know real progress, just call showLoader("Loading fees...")
  // and it will auto-creep toward 90% until you call hideLoader().
  // The ring itself only mounts after SHOW_DELAY_MS — fast (<1s) loads
  // never see it at all.
  const showLoader = useCallback((text = "Loading...", autoSimulate = true) => {
    setLabel(text);
    pendingHide.current = false;
    clearTimeout(showTimer.current);
    clearInterval(simInterval.current);

    showTimer.current = setTimeout(() => {
      if (pendingHide.current) return; // already resolved before delay elapsed
      setProgress(autoSimulate ? 0 : null);
      setIsLoading(true);
      shownAt.current = Date.now();

      if (autoSimulate) {
        let p = 0;
        simInterval.current = setInterval(() => {
          p = Math.min(p + Math.random() * 12, 90);
          setProgress(p);
        }, 200);
      }
    }, SHOW_DELAY_MS);
  }, []);

  // Call this when your real fetch resolves.
  const hideLoader = useCallback(() => {
    pendingHide.current = true;
    clearTimeout(showTimer.current);
    clearInterval(simInterval.current);

    // Never actually shown (fetch was fast) — nothing to clean up.
    if (!shownAt.current) return;

    const elapsed = Date.now() - shownAt.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

    setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setIsLoading(false);
        setProgress(null);
        shownAt.current = null;
      }, 250);
    }, wait);
  }, []);

  // For manual/real progress tracking (e.g. multi-step fetch), call this directly.
  const updateProgress = useCallback((value, text) => {
    clearInterval(simInterval.current);
    setProgress(value);
    if (text) setLabel(text);
  }, []);

  return (
    <LoadingContext.Provider
      value={{ isLoading, progress, label, showLoader, hideLoader, updateProgress }}
    >
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error("useLoading must be used within a LoadingProvider");
  return ctx;
}
