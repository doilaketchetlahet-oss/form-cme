"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type FullscreenTarget = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };

export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const fallbackRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const target = targetRef.current;
    const doc = document as FullscreenDocument;
    const current = () => doc.fullscreenElement || doc.webkitFullscreenElement;
    const sync = () => {
      if (current() === target) setExpanded(true);
      else if (!fallbackRef.current) setExpanded(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!fallbackRef.current && current() !== target)) return;
      fallbackRef.current = false;
      setExpanded(false);
      if (current() === target) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        void Promise.resolve(exit?.call(doc)).catch(() => undefined);
      }
    };
    doc.addEventListener("fullscreenchange", sync);
    doc.addEventListener("webkitfullscreenchange", sync);
    doc.addEventListener("keydown", onKey);
    return () => {
      mountedRef.current = false;
      doc.removeEventListener("fullscreenchange", sync);
      doc.removeEventListener("webkitfullscreenchange", sync);
      doc.removeEventListener("keydown", onKey);
      if (current() === target) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        void Promise.resolve(exit?.call(doc)).catch(() => undefined);
      }
    };
  }, [targetRef]);

  const toggle = async () => {
    const target = targetRef.current as FullscreenTarget | null;
    if (!target || busyRef.current) return;
    const doc = document as FullscreenDocument;
    busyRef.current = true;
    setBusy(true);
    try {
      if (fallbackRef.current || (doc.fullscreenElement || doc.webkitFullscreenElement) === target) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (!fallbackRef.current && exit) await exit.call(doc);
        fallbackRef.current = false;
        if (mountedRef.current) setExpanded(false);
      } else {
        const enter = target.requestFullscreen || target.webkitRequestFullscreen;
        try {
          if (!enter) throw new Error("Fullscreen unavailable");
          await enter.call(target);
          fallbackRef.current = (doc.fullscreenElement || doc.webkitFullscreenElement) !== target;
        } catch {
          // Browsers without element fullscreen can still expand the entire
          // scanner within the page, preserving camera controls and dialogs.
          fallbackRef.current = true;
        }
        if (mountedRef.current) setExpanded(true);
      }
    } catch {
      // If the browser refuses to exit, its fullscreenchange event remains
      // authoritative and the operator can retry or use Escape.
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return { expanded, busy, toggle };
}
