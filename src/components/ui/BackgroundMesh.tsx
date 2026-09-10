"use client";

export function BackgroundMesh() {
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: -1 }}>
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 10% 10%, rgba(14,165,233,0.14) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 90% 90%, rgba(6,182,212,0.10) 0%, transparent 60%),
            radial-gradient(ellipse 50% 40% at 50% 50%, rgba(45,212,191,0.07) 0%, transparent 60%),
            #f2f8fd
          `,
        }}
      />
    </div>
  );
}
