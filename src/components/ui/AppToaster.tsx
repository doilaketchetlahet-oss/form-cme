"use client";
import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        style: { borderRadius: "14px", fontSize: "14px" },
      }}
    />
  );
}
