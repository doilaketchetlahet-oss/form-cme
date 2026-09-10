import { create } from "zustand";

export type EkycStep = "idle" | "camera" | "preview" | "uploading" | "done" | "error";

interface EkycState {
  step: EkycStep;
  qualityScore: number;
  directionHint: string;
  capturedBlob: Blob | null;
  capturedUrl: string | null;
  faceDescriptor: Float32Array | null;
  photoUrl: string | null;
  errorMsg: string;
  setStep: (step: EkycStep) => void;
  setQuality: (score: number, hint: string) => void;
  setCaptured: (blob: Blob, url: string, descriptor: Float32Array | null) => void;
  reset: () => void;
}

export const useEkycStore = create<EkycState>((set) => ({
  step: "idle",
  qualityScore: 0,
  directionHint: "",
  capturedBlob: null,
  capturedUrl: null,
  faceDescriptor: null,
  photoUrl: null,
  errorMsg: "",
  setStep: (step) => set({ step }),
  setQuality: (score, hint) => set({ qualityScore: score, directionHint: hint }),
  setCaptured: (blob, url, descriptor) =>
    set({ capturedBlob: blob, capturedUrl: url, faceDescriptor: descriptor, step: "preview" }),
  reset: () =>
    set({
      step: "idle",
      qualityScore: 0,
      directionHint: "",
      capturedBlob: null,
      capturedUrl: null,
      faceDescriptor: null,
      photoUrl: null,
      errorMsg: "",
    }),
}));

export type VipVerifyStep = "idle" | "scanning" | "verifying" | "verified" | "review" | "error";

interface VipVerifyState {
  step: VipVerifyStep;
  matchedName: string;
  matchedResponseId: string;
  similarity: number;
  errorMsg: string;
  setStep: (step: VipVerifyStep) => void;
  setMatch: (name: string, responseId: string, similarity: number) => void;
  setError: (msg: string) => void;
  reset: () => void;
}

export const useVipVerifyStore = create<VipVerifyState>((set) => ({
  step: "idle",
  matchedName: "",
  matchedResponseId: "",
  similarity: 0,
  errorMsg: "",
  setStep: (step) => set({ step }),
  setMatch: (name, responseId, similarity) =>
    set({ matchedName: name, matchedResponseId: responseId, similarity }),
  setError: (msg) => set({ errorMsg: msg, step: "error" }),
  reset: () =>
    set({
      step: "idle",
      matchedName: "",
      matchedResponseId: "",
      similarity: 0,
      errorMsg: "",
    }),
}));