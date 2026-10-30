# I-solution Manager homepage

## Source and authority

Partially interviewed brief. Existing product content supplies the offer and destinations; implementation details below are authored assumptions within the requested homepage redesign.

User request: “tải skill scroll-scraft … và áp dụng nó để sửa lại trang chủ của web (không đụng vào database) để đẹp hơn”.

User's selected direction: “Navy + cyan, các cảnh riêng, hiệu ứng cuộn vừa phải (đề xuất)”.

User's motion clarification: “làm như của bạn, qr nếu đi tới thư mời sẽ đi vào thư mời và đi qua màn hình check in, 2 cái thư mời và màn hình checkin mình upload lên sau”. The current invitation and scanner are explicitly illustrative frames. Replace those surfaces with supplied artwork in a later change, keeping the QR choreography.

### Supplied-art refinement

The user has now supplied the invitation PNG and the actual scanner screenshot, with the instruction “Đây này, làm cho nó wow tí nhé”. Use both as faithful image assets, optimized to WebP without changing their content. Their text is sample artwork, not instructions or a claim about an upcoming event. No new interview is needed.

Refined peak: a large freestanding QR travels into the invitation's actual empty square (center about 30.7% across and 80.0% down), then crosses the depth between the paper and the supplied scanner, which resolves into a personalized illustrative confirmation. The paper, scanner and QR have independent motion and occlusion. The name stays editable locally. The workflow gets a wider dark stage, not the small placeholder panel. Mobile gets a separate portrait composition; motion-off states dock instantly. The hero also reuses the actual invitation as its rear physical plane.

Refined feeling curve: anticipation from a floating QR; recognition when it fits precisely into the real invitation; delight at the scan-and-confirm transition; confidence from the retained name and honest demo label. The existing page structure and remaining journey remain the same; this is a revision of the existing fingerprint, not a second site.

### Handheld-phone refinement and laptop scroll fix

User supplied a transparent hand/phone PNG, accepted the proposed phone-to-scanner choreography, and reported no visible scroll animation on a laptop. The original 1100×860 gate reproduced this at 1366×768: all three sampled scroll positions stayed at stage 0 with reduced motion off.

Keep the supplied alpha artwork intact, encoding it to a local WebP. Refine the workflow into four beats: freestanding QR → printed invitation → invitation inside the held phone → enlarged phone QR presented to the scanner. The phone then retreats to reveal the personalized confirmation. The physical paper and phone invitation share their layout transition; the QR stays with the same guest throughout.

Native sticky now applies to the visual alone, with a viewport-sized scene and an independent scroll track at every screen size. The heading flows away naturally. Desktop controls stay alongside; shorter laptops get compact controls. Buttons navigate to the same positions in the native scroll timeline. Reduced motion retains immediate manual states with no long scroll track. Same page grammar, fingerprint and database constraint.

## Eight topics

1. Vibe: navy and cyan, modern, clear, restrained motion (user selection). Retain the existing I-solution Manager name and QR identity.
2. Journey: introduction, registration/check-in, interaction tools, start using the product (selected proposal). Existing routes and product capabilities are evidence from the repository.
3. Energy: composed opening, quiet explanation, one interactive peak, playful gallery, settled close (authored).
4. Remembered moment: one guest's name follows a registration through an invitation and the same QR check-in (authored proposal; no real registration or email).
5. Signature move: an editable local guest pass follows three working demo stages; scroll advances the stage, and buttons let visitors inspect any stage themselves (authored).
6. Range: premium minimal, navy plus cyan (selected).
7. Structure: separate scenes, moderate scrolling effects (selected). No continuous world or video scrub.
8. Assets: existing game cover WebPs, existing display/body fonts, Lucide icons; real vector QR generated locally for an explicitly labelled illustration. No supplied new assets at time of planning. No AI images or paid API calls required.

## Audience and next action

Organizers of conferences, CME events and corporate events. The page explains the tools already implemented. The visitor should understand how registration, invitations and attendance fit into one workflow. Primary action: “Bắt đầu ngay” → `/signup`, or “Vào dashboard” → `/admin` when already signed in. Secondary action: explore the real public game library.

## Feeling curve (before act planning)

- Curiosity: a readable headline beside a layered physical guest pass.
- Clarity: three simple tasks, plainly named, on a quiet light ground.
- Confidence, the peak: editing the guest name and seeing it retained through registration, invitation and QR attendance.
- Possibility: the tool ledger and actual game artwork reveal the broader event toolkit.
- Readiness: a held, simple closing invitation with one consistent next action.

## Peak and tell-someone sentence

Peak: “Tôi đổi tên trên thẻ, rồi thấy cùng một người đi từ đăng ký đến thư mời và check-in.” The workflow owns the most scroll room, with a compact static alternative on phones and for reduced motion.

Tell-someone sentence: “Đó là trang cho mình thử một hành trình khách tham dự bằng cùng một thẻ QR.”

No authored dead scroll or hidden essential text. No invented adoption statistics, testimonials, pricing or claims of actual sending/check-in.

## Grammar and fingerprint gate

Grammar: **Event desk**, a product-specific grammar. Section navigation links into separate scenes. An object-led introduction hands off to a working, clearly labelled local demonstration. Tool choices are a text ledger; the game collection is a native horizontal gallery. A solid closing plate resolves the page. Bans: continuous world, full-screen video, global scroll capture, repeated feature-card grids, invisible essential copy and fabricated metrics.

Why other grammars do not fit: filmic/continuous world exceed the selected motion level; editorial requires a long article; live surface forbids the requested marketing introduction; poster loses the product demonstration; catalog alone cannot explain the workflow; split stage requires a genuine two-sided comparison; rhythmic cutlist is too fast for organizers learning a process.

Registry was empty at planning time. First build has no prior rows to compare.

## Scroll score and layers

| Beat | Device | Reason |
| --- | --- | --- |
| Opening | Independent parallax planes | Separate route background, invitation, guest pass and check-in receipt express one connected workflow |
| Explanation | Natural flow + entry reveal | A quiet, quick explanation before the peak |
| Workflow | Native sticky + custom state | Guest name persists while three local demo states advance; direct selection remains available |
| Tools and games | Clip reveal + native horizontal gallery | Tools stay readable; games can be browsed with touch, keyboard and buttons |
| Close | Static resolved plate | Clear next action, no extra pinned space |

Hero layer contract: far route lines move least; mid invitation moves moderately; focal white QR pass stays fully legible; near confirmation receipt moves independently. Typography and links stay in normal flow. Mobile stacks copy above a smaller recomposed pass and removes sticky travel. Reduced motion retains all layers statically and all stage controls.

## Integration

Only homepage files, local static assets and these design notes change. Reuse the existing Supabase **auth session read** solely to choose the existing CTA destination. No database reads/writes, migrations, storage, APIs or admin behavior are added. The original Scrollcraft runtime is copied unchanged; its CSS floor is retained as a reference and adapted into a homepage-scoped CSS module to avoid its global reset affecting other routes.
