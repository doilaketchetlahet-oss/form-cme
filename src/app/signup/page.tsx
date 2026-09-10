import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { BackgroundMesh } from "@/components/ui/BackgroundMesh";

export default function SignupPage() {
  return (
    <main className="relative">
      <BackgroundMesh />
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </main>
  );
}
