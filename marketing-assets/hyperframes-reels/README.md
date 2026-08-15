# Zoree TMS — HyperFrames animated reels

Five 9:16 reels (1080×1920, 30fps) as HyperFrames compositions — animated kinetic-type
hooks, sliding caption panels, a progress bar over each clip, and an animated CTA end
card. Same footage and copy as the static versions in `../reels-hook-series/`, but with
motion design throughout.

## Render (run on this machine, not in Claude's sandbox)

Requires Node 18+ and Chrome installed.

```bat
cd C:\Zoree\zoree-tms-v3\zoree-tms-v3\marketing-assets\hyperframes-reels
npm run render:all
```

First run downloads the HyperFrames CLI and a headless Chrome build (one-time).
If the Chrome download is blocked on your network, point it at your installed Chrome:

```bat
set HYPERFRAMES_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
npm run render:all
```

Output lands in `renders\`. Render a single reel with `npm run render:r1` … `render:r5`.

## Preview / edit interactively

```bat
npm run dev
```

Opens the HyperFrames studio in a browser — scrub the timeline, tweak text or timing in
the HTML files under `reels\`, and it hot-reloads.

## Project layout

- `index.html` — reel 1 (project root composition; identical to `reels/reel1_...html`)
- `reels/` — all five reel compositions
  - `reel1_cheapest_carrier.html` (23s) — "What if every load found its cheapest carrier by itself?"
  - `reel2_spreadsheets.html` (28s) — "Still running freight on spreadsheets?"
  - `reel3_zoree_ai.html` (26s) — "One instruction. Planned. Tendered. Tracked."
  - `reel4_carrier_portal.html` (26s) — "What if carriers accepted without a single phone call?"
  - `reel5_results.html` (22s) — "What if your freight saved you $1.5M a year?"
- `assets/` — demo.mp4 (product walkthrough), launch.mp4 (launch film), logo PNGs
- `compositions/`, root `reel*.html` stubs — superseded placeholders, ignore

## Editing copy

All text lives in plain HTML in each reel file (hook lines, caption headline/sub, CTA).
Timing is on `data-start` / `data-duration` attributes; animations in the `<script>`
GSAP timeline at the bottom of each file. Reels are silent — add platform audio when posting.
