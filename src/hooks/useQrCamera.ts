"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import QrScanner from "qr-scanner";

type Camera = QrScanner.Camera & { facing?: "user" | "environment" };

function cameraFacing(label: string): Camera["facing"] {
  if (/rear|back|environment|sau/i.test(label)) return "environment";
  if (/front|user|face|trước/i.test(label)) return "user";
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Hãy cho phép camera trong trình duyệt rồi bấm Thử lại.";
  return "Không mở được camera đã chọn. Kiểm tra quyền camera và đóng ứng dụng khác đang dùng camera rồi thử lại.";
}

async function tuneVideo(video: HTMLVideoElement) {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  try {
    await track?.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 },
      advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet] });
  } catch { /* Optional resolution/focus hints must not prevent scanning. */ }
}

export function useQrCamera(videoRef: RefObject<HTMLVideoElement | null>, onScan: (url: string) => void, paused: boolean) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [activeCamera, setActiveCamera] = useState("");
  const [switching, setSwitching] = useState(true);
  const [cameraError, setCameraError] = useState("");
  const [mirrored, setMirrored] = useState(false);
  const scannerRef = useRef<QrScanner | null>(null);
  const changingRef = useRef(true);
  const activeRef = useRef("");
  const retryTargetRef = useRef("environment");
  const pausedRef = useRef(paused);
  const mirrorRef = useRef(false);
  const onDecoded = useEffectEvent((result: QrScanner.ScanResult) => onScan(result.data));

  const syncVideoMirror = useCallback(() => {
    if (videoRef.current) videoRef.current.style.transform = mirrorRef.current ? "scaleX(-1)" : "none";
  }, [videoRef]);

  // Read the stream that actually opened, rather than the requested preference:
  // qr-scanner silently falls back to another camera if a preference fails.
  const readCamera = async (scanner: QrScanner) => {
    const video = videoRef.current;
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!video || !track) throw new Error("No camera stream");
    const settings = track.getSettings();
    let available: QrScanner.Camera[] = [];
    try { available = await QrScanner.listCameras(); } catch { /* Keep the active device available. */ }
    const id = settings.deviceId || available.find((camera) => camera.label === track.label)?.id
      || (available.length === 1 ? available[0].id : "");
    if (id && !available.some((camera) => camera.id === id)) available.push({ id, label: track.label || "Camera hiện tại" });
    if (scannerRef.current !== scanner || (video.srcObject as MediaStream | null)?.getVideoTracks()[0] !== track) return id;
    const choices = available.filter((camera) => camera.id).map((camera) => {
      const facing = camera.id === id && (settings.facingMode === "user" || settings.facingMode === "environment")
        ? settings.facingMode : cameraFacing(camera.label);
      const prefix = facing === "user" ? "Camera trước" : facing === "environment" ? "Camera sau" : "";
      return { ...camera, facing, label: prefix && camera.label !== prefix ? `${prefix} — ${camera.label}` : camera.label };
    });
    activeRef.current = id;
    setCameras(choices);
    setActiveCamera(id);
    syncVideoMirror();
    return id;
  };
  const onCameraStarted = useEffectEvent(readCamera);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, (result) => onDecoded(result), {
      preferredCamera: "environment", maxScansPerSecond: 6,
      calculateScanRegion: (element) => {
        const width = Math.floor(element.videoWidth * 0.75), height = Math.floor(element.videoHeight * 0.75);
        return { x: Math.floor((element.videoWidth - width) / 2), y: Math.floor((element.videoHeight - height) / 2), width, height };
      },
      highlightScanRegion: false, highlightCodeOutline: false, returnDetailedScanResult: true,
    });
    scannerRef.current = scanner;
    changingRef.current = true;
    void (async () => {
      try {
        await scanner.start();
        if (scannerRef.current !== scanner) return;
        await onCameraStarted(scanner);
        await tuneVideo(video);
        if (scannerRef.current === scanner) setCameraError("");
      } catch (error) {
        if (scannerRef.current === scanner) setCameraError(cameraErrorMessage(error));
      } finally {
        if (scannerRef.current === scanner) {
          if (pausedRef.current) void scanner.pause();
          changingRef.current = false;
          setSwitching(false);
        }
      }
    })();
    return () => {
      scannerRef.current = null;
      void scanner.pause(true);
      scanner.destroy();
    };
  }, [videoRef]);

  const selectCamera = async (target: string) => {
    const scanner = scannerRef.current;
    const video = videoRef.current;
    if (!scanner || !video || changingRef.current || pausedRef.current) return;
    const previous = activeRef.current;
    retryTargetRef.current = target;
    changingRef.current = true;
    setSwitching(true);
    setCameraError("");
    try {
      await scanner.setCamera(target);
      await scanner.start();
      if (scannerRef.current !== scanner) return;
      const actual = await readCamera(scanner);
      if (scannerRef.current !== scanner) return;
      if (target !== "environment" && target !== "user" && actual !== target) throw new Error("Camera preference was not fulfilled");
      await tuneVideo(video);
    } catch (error) {
      if (scannerRef.current !== scanner) return;
      // Restore the last working device if the new one is unavailable/busy.
      let restored = false;
      if (previous && target !== previous) {
        try {
          await scanner.setCamera(previous);
          await scanner.start();
          restored = await readCamera(scanner) === previous;
        } catch { /* Show the retry action if recovery also fails. */ }
      }
      if (scannerRef.current === scanner) setCameraError(restored
        ? "Không đổi được camera. Đã giữ camera đang dùng; bạn có thể chọn camera khác hoặc thử lại."
        : cameraErrorMessage(error));
    } finally {
      if (scannerRef.current === scanner) {
        if (pausedRef.current) void scanner.pause();
        changingRef.current = false;
        setSwitching(false);
      }
    }
  };

  const resumeCamera = useEffectEvent(() => selectCamera(activeRef.current || "environment"));
  useEffect(() => {
    pausedRef.current = paused;
    const scanner = scannerRef.current;
    if (!scanner || changingRef.current) return;
    if (paused) void scanner.pause();
    else void resumeCamera();
  }, [paused]);

  const switchCamera = () => {
    const current = cameras.find((camera) => camera.id === activeCamera);
    const opposite = cameras.find((camera) => camera.id !== activeCamera && camera.facing && current?.facing && camera.facing !== current.facing);
    const next = opposite ?? cameras[(cameras.findIndex((camera) => camera.id === activeCamera) + 1) % cameras.length];
    if (next && next.id !== activeCamera) void selectCamera(next.id);
  };

  const toggleMirror = () => {
    mirrorRef.current = !mirrorRef.current;
    setMirrored(mirrorRef.current);
    syncVideoMirror();
  };

  return { cameras, activeCamera, switching, cameraError, mirrored, selectCamera, switchCamera, toggleMirror,
    syncVideoMirror, retryCamera: () => selectCamera(retryTargetRef.current) };
}
