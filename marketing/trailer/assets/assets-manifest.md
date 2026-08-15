# Trailer Assets Manifest

Everything harvested from the project folder. All UI content is real — no generated screens.

## ui-clips/ — real screen-recording cuts (from zoree_demo_3min_silent.mp4, 1920×1030, H.264 CRF16)

| File | Demo source | Content | Used in |
|---|---|---|---|
| u0-orders-establish.mp4 | 0:00–0:10 | Orders workspace + Bulk Plan Scheduler | Scene 3B reveal |
| u1-rate-modal.mp4 | 0:18–0:36 | Plan modal, live carrier rates | Scene 4A (PLAN) |
| u2-bulk-results.mp4 | 0:40–0:49 | Plan Selected → Bulk Plan Results | Scene 4B |
| u4-tender-sent.mp4 | 1:08–1:16 | Tender Sent Successfully card | Scene 5A hero |
| u5-tender-email.mp4 | 1:15–1:27 | Gmail load tender / rate confirmation | Scene 5B |
| u6-carrier-accept.mp4 | 1:33–1:52 | Carrier Portal accept flow → banner | Scene 5C |
| u7-dock-gantt.mp4 | 1:50–2:06 | Dock Scheduling Gantt | Scene 5D |
| u8-zoree-ai.mp4 | 2:30–2:55 | ZoreeAI plans + tenders order | Scene 7B (AI ASSISTANT) |
| u9-live-map-animated-placeholder.mp4 | rendered | Trucks gliding along route over real Live Tracking screenshot + Ken Burns (10s) | Scene 6A placeholder for animatic — replace with real recording |

Note: u3 intentionally unused (shipment details modal — covered by u4/u5).

## stills/ — 4K upscales (3840×2160, lanczos + light sharpen, from demo/screenshots/)

| File | Content | Used in |
|---|---|---|
| 14-live-tracking-4k.jpg | Live Tracking map, US-wide markers, shipment cards | Scene 6A (TRACK) — Ken Burns zoom |
| 20-analytics-4k.jpg | Analytics: KPIs, spend by mode, carrier scorecard | Scene 7A (OPTIMIZE) — animated crops |
| 02-dashboard-4k.jpg | Home dashboard KPIs | Alt for Scene 3B/7A |
| 22-ai-assistant-4k.jpg | ZoreeAI panel | Insert for Scene 7B |
| 03-orders-4k.jpg | Orders list | Alt establishing |
| 16-dock-scheduling-4k.jpg | Dock Gantt clean still | Insert for 5D |
| 08-carrier-portal-4k.jpg | Carrier Portal stats (100% acceptance) | Freeze-frame option 5C |
| 05-shipments-map-4k.jpg | Shipments map view | Alt for Scene 6A |

Upscales are 2× lanczos from 1080p — crisp for moves up to ~120% zoom in a 4K timeline; fine at any zoom for 1080p delivery.

## brand/
- zoree-mark.svg — Z mark (from frontend/public/favicon.svg). Vector, safe at any size for Scenes 3A/8B.

## Other reusable material found in repo
- `marketing/Zoree_TMS_promo_v2.mp4` — 67s motion-graphics promo (dark navy, device frames, stat cards: 10-20% savings, 15+ hrs, <7 days). Different style from trailer; its stat trio is a proven beat — optional insert before Scene 8.
- `zoree_demo/voiceover_script.md` + `generate_voiceover.py` — existing TTS pipeline (Microsoft Aria neural). Can render the trailer narration for the animatic; final trailer should use a premium VO (ElevenLabs or human).
- `zoree_demo/zoree_demo_3min_silent.mp4` — full demo master; source for any additional UI cuts.

## Fresh recordings to capture on Windows (1920×1080, cursor hidden)
1. **Live Tracking (~12s) — now animated.** `LiveTrackingPage.jsx` has truck-along-route animation (trucks glide continuously along their polylines; card % now matches truck position). Reload the app and record the map idle — this replaces `u9-…placeholder.mp4` with real footage. The 40-shipment dataset view (many blue dashed lanes) is the one to record.
2. **Analytics (~8s):** slow scroll over charts. 4K still fallback exists.
3. **Dock Scheduling (~8s):** the current view is stronger than the archived still — Tue May 5 2026, KPIs **84 HRS total slots / 35 scheduled / 0 DOORS FREE**, 6 doors solid with AVERITT / KLLM / J.B. HUNT outbound blocks 06:00–13:00, confirmed appointment cards below. Record a slow lateral pan of the Gantt, then hold 1s on the KPI row. Also save a 1920×1080 screenshot of this exact view as `stills/16b-dock-scheduling-full.png` for the 4K upscale.

Scene 5D beat upgrade: end the dock shot with a spotlight on "0 DOORS FREE" — full utilization is the proof point.
