"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "isolution-journey-motion";
const CHANGE_EVENT = "isolution-journey-motion-change";
const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(MEDIA_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSnapshot() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "on" || saved === "off") return saved;
  } catch {
    // Private browsing/storage restrictions still allow an in-memory choice.
  }
  return window.matchMedia(MEDIA_QUERY).matches
    ? "system-reduced"
    : "system-full";
}

// A stable server snapshot prevents OS-specific hydration mismatches.
const getServerSnapshot = () => "system-full" as const;

export function useJourneyMotion() {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [localChoice, setLocalChoice] = useState<boolean | null>(null);
  const reduced =
    localChoice === null
      ? preference === "off" || preference === "system-reduced"
      : !localChoice;

  function setMotionEnabled(enabled: boolean) {
    setLocalChoice(enabled);
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // Keep the choice for this mounted page even when persistence is unavailable.
    }
  }

  return {
    reduced,
    systemReduced: localChoice === null && preference === "system-reduced",
    setMotionEnabled,
  };
}
