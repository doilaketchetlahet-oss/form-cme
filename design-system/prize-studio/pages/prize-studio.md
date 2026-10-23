# Prize Studio: web implementation decisions

Applied the UI/UX Pro Max SaaS dashboard match to the existing Next.js app.
The first premium-entertainment result suggested storytelling / Apple liquid glass;
that was rejected as inappropriate for a registration and inventory tool.

- Keep the existing Vietnamese font and Lucide icons; add no font/icon dependency.
- White opaque cards, slate text, sky-blue actions, subtle blue/amber page backdrop.
- Dashboard uses four sections: settings, registration, prizes, participants.
  The marketing-page hero/scroll narrative from the generic match is not used.
- Form belongs to the campaign. QR links to its dedicated registration route.
- On phones, one main action per step: register, then spin. Keep labels visible,
  controls at least 44px tall, body inputs 16px, and layouts without horizontal overflow.
- Gift photography uses contained square frames, explicit dimensions and a gift
  fallback when absent/broken. Uploads are normalized to WebP server-side.
- Existing wheel remains the only significant animation; reduced motion skips it.
- Configurable button colours choose contrasting foreground automatically.
- Save bar appears only for dirty settings. Destructive campaign deletion requires
  an explicit dialog and preserves award history while closing the public experience.
