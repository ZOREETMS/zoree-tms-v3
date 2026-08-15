# Zoree Demo Video — Analysis (Phase 1)

Source analyzed: `zoree_demo/zoree_demo_3min_silent.mp4` (2:55, 1920×1030, silent — this is the demo.mp4 on zoree.io/zoree-demo).

## Actual demo timeline (as recorded)

| Time | Content |
|---|---|
| 0:00–0:45 | Orders page, Bulk Plan Scheduler, filtering, single-order Plan modal with live carrier rates (Averitt, KLLM, Schneider, Werner, J.B. Hunt), dock-door reservation |
| 0:35–0:50 | Multi-select orders → Plan Selected → Bulk Plan Results (green success) |
| ~0:52 | **Blank white frame** (page transition) |
| 0:55–1:10 | Shipments list → Shipment Details modal (cost, timeline, change history) |
| ~1:12 | **"TENDER SENT SUCCESSFULLY"** green confirmation card |
| 1:15–1:25 | Gmail — professional load tender / rate confirmation email |
| 1:27–1:50 | Carrier Portal — tender stats, Respond-to-Tender accept modal, acceptance banner |
| 1:50–2:05 | Dock Scheduling — green Gantt grid, door appointments |
| 2:05–2:55 | ZoreeAI chat — plans an order, creates SHP-2026-72578, tenders it via natural language |

## 1. Strongest scenes

1. **Plan modal with live carrier rates** (~0:20–0:35) — real rate shopping across named national carriers. Instantly credible.
2. **"Tender Sent Successfully" card** (~1:12) — a clean, satisfying "moment of magic." Perfect trailer beat.
3. **Gmail tender email** (~1:15–1:25) — proof the system touches the real world. Rare in TMS demos.
4. **Carrier Portal accept flow** (~1:35–1:50) — shows the two-sided network; 100% acceptance stat is a great freeze-frame.
5. **Dock Scheduling Gantt** (~1:52–2:05) — the green grid is the most visually cinematic screen in the product.
6. **ZoreeAI end-to-end plan + tender** (~2:35–2:55) — the payoff: "plan the order" → shipment created → tendered. The differentiator.

## 2. Weakest scenes

1. 0:00–0:45 opening — 45 seconds of list filtering before anything happens. Executives are gone by 0:10.
2. ~0:52 blank white frame — must never appear in any cut.
3. AI chat section is 50 seconds of small text and typing. Right content, wrong pacing.
4. Repeated near-identical Orders-page views (f1–f3, f26–f27) add no information.
5. Entire video is silent — no narration, no music, no sound design.
6. Small dense UI text unreadable at web scale without crops/zooms.

## 3. Places to speed up

1. 0:00–0:45 order filtering → compress to 2–3s or skip entirely in the trailer.
2. AI chat typing → 4–8× time-lapse with animated crop zooms on the AI's responses only.
3. Dock scheduling scrolling → single 2s push-in on the Gantt, not the full scroll.
4. Carrier accept form fill → jump-cut: modal opens → "Confirm Acceptance" → green banner.

## 4. Scenes to cut (for the trailer)

1. The blank white transition frame.
2. All list filtering / searching / date-picker interaction.
3. Duplicate Orders-page establishing shots.
4. Form-field typing (driver name, PRO number, etc.).
5. Gmail inbox navigation — cut straight to the open tender document.

## 5. UI shots worth highlighting (real capture list)

| # | Screen | Timestamp in demo | Trailer treatment |
|---|---|---|---|
| U1 | Plan modal — carrier rate list | ~0:25 | Slow push-in, highlight cheapest rate row |
| U2 | Bulk Plan Results success | ~0:45 | Quick hit, 1.5s |
| U3 | Shipment Details timeline | ~1:05 | Vertical crop pan down the milestones |
| U4 | Tender Sent Successfully card | ~1:12 | Hero moment, scale-up + glow |
| U5 | Gmail tender email | ~1:20 | Crop to rate confirmation doc |
| U6 | Carrier Portal accept modal → banner | ~1:40 | Jump-cut accept |
| U7 | Dock Scheduling Gantt | ~1:55 | Slow lateral pan across green blocks |
| U8 | ZoreeAI: "plan the order" → shipment created | ~2:40 | Zoom on chat, time-lapse, freeze on confirmation |

**Gap:** the demo has no Live Tracking map and no Analytics dashboard footage. Scenes 6 (Visibility) and 7 (Dashboards) need ~20s of fresh screen recording from the app (Live Tracking map with markers; Analytics spend/scorecard charts). Both pages exist in the product — record at 1920×1080, cursor hidden, smooth scrolling only.

## 6. Suggested trailer flow (75–90s)

1. **0–10s** — Cinematic world of freight (AI B-roll: port sunrise, highway, warehouse). No UI. Music builds.
2. **10–20s** — The problem: fragmented operations (dispatcher office B-roll, quick cuts). One-word text: pressure.
3. **20–28s** — Beat drop. Logo reveal: **Zoree**. First UI glimpse.
4. **28–40s** — PLAN: U1 rate shopping → U2 bulk results. Fast, confident.
5. **40–52s** — EXECUTE: U4 tender sent → U5 email → U6 carrier accept → U7 docks.
6. **52–62s** — TRACK: fresh Live Tracking map capture + truck-on-highway B-roll intercut.
7. **62–72s** — INSIGHT + AI: fresh Analytics capture, then U8 ZoreeAI planning an order.
8. **72–85s** — Final: truck into sunrise, logo, "Watch the full demo at zoree.io." CTA drives to the existing demo — it stays untouched.
