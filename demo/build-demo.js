#!/usr/bin/env node
/**
 * build-demo.js
 * Reads screenshot JPGs from ./screenshots/, converts to base64,
 * and generates a self-contained zoree-tms-demo-v3.11.html
 */

const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const OUTPUT = path.join(__dirname, 'zoree-tms-demo-v3.11.html');

// Read and encode each screenshot
function b64(filename) {
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  const buf = fs.readFileSync(filepath);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

console.log('Reading screenshots...');
const imgs = {
  home:           b64('01-home.jpg'),
  dashboard:      b64('02-dashboard.jpg'),
  orders:         b64('03-orders.jpg'),
  shipmentsList:  b64('04-shipments-list.jpg'),
  shipmentsMap:   b64('05-shipments-map.jpg'),
  routeOptimizer: b64('06-route-optimizer.jpg'),
  bulkPlan:       b64('07-bulk-plan.jpg'),
  carrierPortal:  b64('08-carrier-portal.jpg'),
  rateManagement: b64('09-rate-management.jpg'),
  freightInvoices:b64('10-freight-invoices.jpg'),
  lanePreferences:b64('11-lane-preferences.jpg'),
  documentsBol:   b64('12-documents-bol.jpg'),
  bolDetail:      b64('13-bol-detail.jpg'),
  liveTracking:   b64('14-live-tracking.jpg'),
  carriers:       b64('15-carriers.jpg'),
  dockScheduling: b64('16-dock-scheduling.jpg'),
  messaging:      b64('17-messaging.jpg'),
  alerts:         b64('18-alerts.jpg'),
  compliance:     b64('19-compliance.jpg'),
  analytics:      b64('20-analytics.jpg'),
  freightAudit:   b64('21-freight-audit.jpg'),
  aiAssistant:    b64('22-ai-assistant.jpg'),
  routeOptimizerResults: b64('23-route-optimizer-results.jpg'),
  shipmentEvents: b64('24-shipment-events.jpg'),
};
console.log('All screenshots loaded.');

// Build HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zoree TMS v3.11 — Product Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --navy: #061A40;
  --blue: #0A3D7C;
  --teal: #028AB5;
  --teal-l: #01C5E4;
  --mint: #02F5C4;
  --dark: #0B1120;
  --card-bg: rgba(255,255,255,0.06);
  --card-border: rgba(255,255,255,0.10);
  --light-bg: #F4F7FA;
  --light-card: #FFFFFF;
  --text: #FFFFFF;
  --text-dark: #1A2332;
  --text-muted: #8A99B0;
  --yellow: #F5A623;
  --green: #2ECC71;
  --orange: #E67E22;
  --red: #E74C3C;
  --purple: #9B59B6;
  --lt-blue: #3498DB;
}

* { margin:0; padding:0; box-sizing:border-box; }

html, body {
  width: 100%; height: 100%;
  overflow: hidden;
  font-family: 'DM Sans', sans-serif;
  background: var(--dark);
  color: var(--text);
}

/* ======== SCENE SYSTEM ======== */
.scene {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.7s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.scene.active { opacity: 1; pointer-events: all; }
.scene-dark { background: linear-gradient(135deg, var(--dark) 0%, var(--navy) 100%); }

/* ======== SCREENSHOT SCENES ======== */
.screenshot-scene {
  background: #080e1a;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
}
.screenshot-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 0;
}
.screenshot-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  opacity: 0;
  transform: scale(0.98);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.scene.active .screenshot-container img {
  opacity: 1;
  transform: scale(1);
}
.scene.active .screenshot-container img.delay-img {
  transition-delay: 0.3s;
}

/* Dual screenshot layout */
.screenshot-dual {
  display: flex;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 8px;
  align-items: center;
  justify-content: center;
}
.screenshot-dual img {
  max-width: 49%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
}

/* Single screenshot layout */
.screenshot-single {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.screenshot-single img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
}

/* Caption overlay */
.scene-caption {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  background: linear-gradient(0deg, rgba(6,26,64,0.92) 0%, rgba(6,26,64,0.7) 70%, transparent 100%);
  padding: 40px 48px 28px;
  z-index: 10;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease 0.3s, transform 0.6s ease 0.3s;
}
.scene.active .scene-caption {
  opacity: 1;
  transform: translateY(0);
}
.scene-caption .caption-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  background: rgba(2,138,181,0.25);
  color: var(--teal-l);
}
.scene-caption h2 {
  font-family: 'Syne', sans-serif;
  font-weight: 700;
  font-size: 28px;
  margin-bottom: 6px;
  color: #fff;
}
.scene-caption .caption-points {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.scene-caption .caption-point {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
  display: flex;
  align-items: center;
  gap: 6px;
}
.scene-caption .caption-point::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--mint);
  flex-shrink: 0;
}

/* ======== FADE-UP ANIMATION ======== */
.fade-up {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.scene.active .fade-up { opacity: 1; transform: translateY(0); }
.scene.active .fade-up.d1 { transition-delay: 0.15s; }
.scene.active .fade-up.d2 { transition-delay: 0.30s; }
.scene.active .fade-up.d3 { transition-delay: 0.45s; }
.scene.active .fade-up.d4 { transition-delay: 0.60s; }
.scene.active .fade-up.d5 { transition-delay: 0.75s; }
.scene.active .fade-up.d6 { transition-delay: 0.90s; }

/* ======== GLASS CARD ======== */
.glass {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 28px;
  position: relative;
  overflow: hidden;
}
.glass::before {
  content: '';
  position: absolute; top: 0; left: 0;
  width: 4px; height: 100%;
  background: linear-gradient(180deg, var(--teal), var(--mint));
  border-radius: 4px 0 0 4px;
}

.grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 20px; }

/* ======== BACKGROUND CIRCLES ======== */
.bg-circles {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  overflow: hidden; pointer-events: none; z-index: 0;
}
.bg-circle {
  position: absolute; border-radius: 50%;
  border: 1px solid rgba(2,138,181,0.08);
  animation: floatCircle 20s ease-in-out infinite;
}
@keyframes floatCircle {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(20px, -30px) scale(1.05); }
  50% { transform: translate(-10px, 20px) scale(0.95); }
  75% { transform: translate(15px, 10px) scale(1.02); }
}

.accent-bar {
  position: absolute; left: 0; top: 0;
  width: 6px; height: 100%;
  background: linear-gradient(180deg, var(--teal), var(--mint), var(--teal-l));
}

.section-tag {
  display: inline-block;
  padding: 4px 12px; border-radius: 20px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1px;
  margin-bottom: 12px;
  background: rgba(2,138,181,0.15);
  color: var(--teal-l);
}

.scene-inner {
  width: 100%; max-width: 1280px;
  padding: 60px 48px 100px;
}

h1 { font-family: 'Syne', sans-serif; }
h2 { font-family: 'Syne', sans-serif; font-weight: 700; }

.client-logos {
  display: flex; gap: 32px; align-items: center;
  justify-content: center; flex-wrap: wrap; margin-top: 32px;
}
.client-logo {
  font-family: 'Syne', sans-serif;
  font-weight: 800; font-size: 16px;
  color: rgba(255,255,255,0.25);
  letter-spacing: 3px;
  text-transform: uppercase;
}

.cta-card {
  padding: 20px; text-align: center;
  border-radius: 12px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
}
.cta-card h4 { font-size: 14px; margin-bottom: 8px; font-family: 'Syne', sans-serif; font-weight: 600; }
.cta-card p {
  font-size: 13px; color: var(--teal-l);
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

/* ======== PROGRESS BAR ======== */
#progress-bar {
  position: fixed; bottom: 0; left: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--teal), var(--mint));
  transition: width 0.5s ease;
  z-index: 1000;
}

/* ======== CONTROLS ======== */
#controls {
  position: fixed; bottom: 20px; right: 24px;
  display: flex; align-items: center; gap: 10px;
  z-index: 1000;
  background: rgba(6,26,64,0.85);
  backdrop-filter: blur(12px);
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
}
.ctrl-btn {
  width: 34px; height: 34px; border-radius: 8px; border: none;
  background: rgba(255,255,255,0.08);
  color: #fff; font-size: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.15); }
#scene-counter {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: var(--text-muted);
  min-width: 50px; text-align: center;
}
.ctrl-btn.recording {
  background: var(--red);
  animation: recPulse 1.5s ease infinite;
}
@keyframes recPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(231,76,60,0.4); }
  50% { box-shadow: 0 0 0 8px rgba(231,76,60,0); }
}

/* ======== MUSIC PLAYER BAR ======== */
#music-bar {
  position: fixed; bottom: 20px; left: 24px;
  display: flex; align-items: center; gap: 10px;
  z-index: 1000;
  background: rgba(6,26,64,0.85);
  backdrop-filter: blur(12px);
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
}
#track-name {
  font-size: 11px; color: var(--teal-l);
  font-family: 'JetBrains Mono', monospace;
  max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#vol-slider {
  width: 60px; height: 4px;
  -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.15);
  border-radius: 2px; outline: none;
  cursor: pointer;
}
#vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--mint); cursor: pointer;
}
.wave-bars {
  display: flex; align-items: flex-end; gap: 2px; height: 18px;
}
.wave-bar {
  width: 3px; border-radius: 2px;
  background: var(--teal-l);
  animation: waveAnim 0.8s ease-in-out infinite alternate;
}
.wave-bar:nth-child(2) { animation-delay: 0.1s; }
.wave-bar:nth-child(3) { animation-delay: 0.2s; }
.wave-bar:nth-child(4) { animation-delay: 0.3s; }
.wave-bar:nth-child(5) { animation-delay: 0.15s; }
@keyframes waveAnim {
  0% { height: 4px; }
  100% { height: 16px; }
}
.wave-bars.paused .wave-bar { animation-play-state: paused; height: 6px; }

/* ======== RECORDING TIMER ======== */
#rec-timer {
  position: fixed; top: 16px; left: 50%;
  transform: translateX(-50%);
  background: var(--red);
  color: #fff;
  padding: 6px 18px;
  border-radius: 20px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px; font-weight: 600;
  z-index: 1001;
  display: none;
  align-items: center; gap: 8px;
}
#rec-timer .rec-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: recPulse 1.5s ease infinite;
}

/* ======== TOAST ======== */
.toast {
  position: fixed; top: 60px; right: 24px;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 13px; font-weight: 500;
  z-index: 1002;
  transform: translateX(120%);
  transition: transform 0.4s ease;
  background: var(--navy);
  border: 1px solid var(--teal);
  color: #fff;
}
.toast.show { transform: translateX(0); }

/* ======== RESPONSIVE ======== */
@media (max-width: 900px) {
  .grid-4 { grid-template-columns: 1fr 1fr; }
  .scene-inner { padding: 40px 20px 100px; }
  #music-bar { left: 10px; }
  #controls { right: 10px; }
  .client-logos { gap: 16px; }
  .client-logo { font-size: 12px; }
  .screenshot-dual { flex-direction: column; }
  .screenshot-dual img { max-width: 95%; max-height: 48%; }
  .scene-caption h2 { font-size: 22px; }
  .scene-caption .caption-points { flex-direction: column; gap: 6px; }
}
@media (max-width: 600px) {
  .grid-4 { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<!-- PROGRESS BAR -->
<div id="progress-bar" style="width:7%"></div>

<!-- ========================== SCENE 0: TITLE ========================== -->
<div class="scene scene-dark active" id="scene-0">
  <div class="accent-bar"></div>
  <div class="bg-circles">
    <div class="bg-circle" style="width:400px;height:400px;top:-80px;right:-100px;animation-delay:0s;border-color:rgba(2,138,181,0.06);"></div>
    <div class="bg-circle" style="width:250px;height:250px;bottom:10%;left:5%;animation-delay:3s;border-color:rgba(2,245,196,0.05);"></div>
    <div class="bg-circle" style="width:600px;height:600px;top:30%;right:20%;animation-delay:7s;border-color:rgba(1,197,228,0.04);"></div>
  </div>
  <div class="scene-inner" style="text-align:center;position:relative;z-index:1;">
    <div class="fade-up">
      <div class="section-tag">v3.11</div>
    </div>
    <h1 class="fade-up d1" style="font-size:64px;font-weight:800;letter-spacing:-1px;background:linear-gradient(135deg,#fff 30%,var(--teal-l));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;">Zoree TMS</h1>
    <p class="fade-up d2" style="font-size:22px;color:var(--text-muted);font-weight:300;margin-bottom:8px;">Transportation Management System</p>
    <p class="fade-up d3" style="font-size:15px;color:var(--teal-l);letter-spacing:2px;text-transform:uppercase;font-weight:600;">Intelligent Logistics. Real-Time Control.</p>
    <div class="client-logos fade-up d4" style="margin-top:48px;">
      <span class="client-logo">CISCO</span>
      <span class="client-logo">AT&amp;T</span>
      <span class="client-logo">META</span>
      <span class="client-logo">GOOGLE</span>
      <span class="client-logo">XPO</span>
      <span class="client-logo">SEAGATE</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 1: THE CHALLENGE ========================== -->
<div class="scene scene-dark" id="scene-1">
  <div class="bg-circles">
    <div class="bg-circle" style="width:350px;height:350px;top:10%;left:-80px;animation-delay:2s;"></div>
    <div class="bg-circle" style="width:500px;height:500px;bottom:-100px;right:-50px;animation-delay:5s;"></div>
  </div>
  <div class="scene-inner" style="position:relative;z-index:1;">
    <div class="section-tag fade-up">The Challenge</div>
    <h2 class="fade-up d1" style="font-size:36px;margin-bottom:32px;">Logistics Without the Right Tools is Costly</h2>
    <div class="grid-4">
      <div class="glass fade-up d2" style="text-align:center;padding:32px 20px;">
        <div style="font-size:32px;margin-bottom:12px;">&#9888;</div>
        <h4 style="font-size:15px;margin-bottom:8px;">Manual Processes</h4>
        <p style="font-size:12px;color:var(--text-muted);">Spreadsheets, phone calls, and emails slow down every shipment from planning to delivery.</p>
      </div>
      <div class="glass fade-up d3" style="text-align:center;padding:32px 20px;">
        <div style="font-size:32px;margin-bottom:12px;">&#128200;</div>
        <h4 style="font-size:15px;margin-bottom:8px;">Uncontrolled Freight Spend</h4>
        <p style="font-size:12px;color:var(--text-muted);">No rate shopping, no consolidation, no visibility into where your freight dollars go.</p>
      </div>
      <div class="glass fade-up d4" style="text-align:center;padding:32px 20px;">
        <div style="font-size:32px;margin-bottom:12px;">&#128065;</div>
        <h4 style="font-size:15px;margin-bottom:8px;">Zero Visibility</h4>
        <p style="font-size:12px;color:var(--text-muted);">No real-time tracking, no KPIs, no way to know if carriers are performing.</p>
      </div>
      <div class="glass fade-up d5" style="text-align:center;padding:32px 20px;">
        <div style="font-size:32px;margin-bottom:12px;">&#128268;</div>
        <h4 style="font-size:15px;margin-bottom:8px;">Disconnected Systems</h4>
        <p style="font-size:12px;color:var(--text-muted);">ERP, WMS, carrier portals, and accounting tools that don't talk to each other.</p>
      </div>
    </div>
    <p class="fade-up d6" style="text-align:center;margin-top:32px;color:var(--teal-l);font-size:15px;font-weight:500;">Zoree TMS solves all four &mdash; in one browser-based platform.</p>
  </div>
</div>

<!-- ========================== SCENE 2: HOME & DASHBOARD ========================== -->
<div class="scene screenshot-scene" id="scene-2">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.home}" alt="Zoree TMS Home">
      <img src="${imgs.dashboard}" alt="Zoree TMS Dashboard" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Platform Overview</span>
    <h2>Home &amp; Dashboard</h2>
    <div class="caption-points">
      <span class="caption-point">AI-powered insights on landing page</span>
      <span class="caption-point">Real-time KPI dashboard with order &amp; shipment metrics</span>
      <span class="caption-point">Quick-access modules for every logistics function</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 3: AI ASSISTANT ========================== -->
<div class="scene screenshot-scene" id="scene-3">
  <div class="screenshot-container">
    <div class="screenshot-single">
      <img src="${imgs.aiAssistant}" alt="Zoree AI Assistant">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">AI Intelligence</span>
    <h2>Zoree AI Assistant</h2>
    <div class="caption-points">
      <span class="caption-point">Conversational AI copilot built into the platform</span>
      <span class="caption-point">Queries live TMS data for shipment summaries, carrier performance, and freight spend</span>
      <span class="caption-point">Instant actionable insights without navigating away</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 4: ORDER MANAGEMENT ========================== -->
<div class="scene screenshot-scene" id="scene-4">
  <div class="screenshot-container">
    <div class="screenshot-single">
      <img src="${imgs.orders}" alt="Order Management">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Planning</span>
    <h2>Order Management</h2>
    <div class="caption-points">
      <span class="caption-point">Auto-consolidation engine groups orders by lane</span>
      <span class="caption-point">Bulk plan scheduler with rate shopping across TL, LTL, Parcel</span>
      <span class="caption-point">Full audit trail and status tracking from creation to delivery</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 5: SHIPMENT PLANNING ========================== -->
<div class="scene screenshot-scene" id="scene-5">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.shipmentsList}" alt="Shipments List View">
      <img src="${imgs.shipmentsMap}" alt="Shipments Map View" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Planning</span>
    <h2>Shipment Planning &amp; Visibility</h2>
    <div class="caption-points">
      <span class="caption-point">List view with status filters and shipment details</span>
      <span class="caption-point">HERE Maps integration for geographic shipment visualization</span>
      <span class="caption-point">Route optimization with PC Miler mileage data</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 6: SHIPMENT EVENTS ========================== -->
<div class="scene screenshot-scene" id="scene-6">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.shipmentsList}" alt="Shipments List View">
      <img src="${imgs.shipmentEvents}" alt="Shipment Events Detail" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Execution</span>
    <h2>Shipment Detail &amp; Event Timeline</h2>
    <div class="caption-points">
      <span class="caption-point">Real-time progress tracking with carrier info and delivery dates</span>
      <span class="caption-point">Complete event timeline with dock scheduling and custom events</span>
      <span class="caption-point">Associated orders, line items, and actions directly from the modal</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 7: ROUTE OPTIMIZER ========================== -->
<div class="scene screenshot-scene" id="scene-7">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.routeOptimizer}" alt="Route Optimizer Input">
      <img src="${imgs.routeOptimizerResults}" alt="Route Optimizer Results" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Optimization</span>
    <h2>Route Optimizer &amp; Rate Comparison</h2>
    <div class="caption-points">
      <span class="caption-point">Compares every carrier and rate for your lane in one click</span>
      <span class="caption-point">Best option highlighted with HOS compliance and cost breakdown</span>
      <span class="caption-point">Factors in service level, transit time, and total cost</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 8: RATE & CARRIER MANAGEMENT ========================== -->
<div class="scene screenshot-scene" id="scene-8">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.rateManagement}" alt="Rate Management">
      <img src="${imgs.carrierPortal}" alt="Carrier Portal" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Execution</span>
    <h2>Rate &amp; Carrier Management</h2>
    <div class="caption-points">
      <span class="caption-point">43 active rates across Werner, JB Hunt, Averitt, Old Dominion</span>
      <span class="caption-point">CzarLite integration for real-time LTL pricing</span>
      <span class="caption-point">Carrier portal with tender accept/reject workflow</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 9: DOCUMENTS & BOL ========================== -->
<div class="scene screenshot-scene" id="scene-9">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.documentsBol}" alt="Documents &amp; BOL Library">
      <img src="${imgs.bolDetail}" alt="BOL Detail View" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Documents</span>
    <h2>Documents &amp; Bill of Lading</h2>
    <div class="caption-points">
      <span class="caption-point">BOL library with auto-generated documents from shipment data</span>
      <span class="caption-point">Detailed BOL modal with shipper, consignee, and item breakdown</span>
      <span class="caption-point">Print-ready formats and digital document management</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 10: EXECUTION ========================== -->
<div class="scene screenshot-scene" id="scene-10">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.liveTracking}" alt="Live Tracking">
      <img src="${imgs.dockScheduling}" alt="Dock Scheduling" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Execution</span>
    <h2>Live Tracking &amp; Dock Scheduling</h2>
    <div class="caption-points">
      <span class="caption-point">Real-time shipment tracking with HERE Maps</span>
      <span class="caption-point">Dock scheduling grid with drag-and-drop appointment management</span>
      <span class="caption-point">Color-coded by type: inbound, outbound, cross-dock</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 11: FINANCE ========================== -->
<div class="scene screenshot-scene" id="scene-11">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.freightInvoices}" alt="Freight Invoices">
      <img src="${imgs.freightAudit}" alt="Freight Audit" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Finance</span>
    <h2>Freight Invoices &amp; Audit</h2>
    <div class="caption-points">
      <span class="caption-point">3-way match: invoice vs. rate vs. shipment data</span>
      <span class="caption-point">Automated discrepancy detection and variance alerts</span>
      <span class="caption-point">Complete freight audit trail with approval workflows</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 12: INTELLIGENCE ========================== -->
<div class="scene screenshot-scene" id="scene-12">
  <div class="screenshot-container">
    <div class="screenshot-dual">
      <img src="${imgs.alerts}" alt="Alerts &amp; Exceptions">
      <img src="${imgs.analytics}" alt="Analytics" class="delay-img">
    </div>
  </div>
  <div class="scene-caption">
    <span class="caption-tag">Intelligence</span>
    <h2>Alerts, Analytics &amp; Optimization</h2>
    <div class="caption-points">
      <span class="caption-point">Real-time alerts and exception management</span>
      <span class="caption-point">Lane carrier preferences with performance grading</span>
      <span class="caption-point">Analytics dashboards for freight spend and carrier scorecards</span>
    </div>
  </div>
</div>

<!-- ========================== SCENE 13: CLOSING CTA ========================== -->
<div class="scene scene-dark" id="scene-13">
  <div class="bg-circles">
    <div class="bg-circle" style="width:500px;height:500px;top:-100px;right:-80px;animation-delay:1s;border-color:rgba(2,245,196,0.06);"></div>
    <div class="bg-circle" style="width:300px;height:300px;bottom:5%;left:10%;animation-delay:4s;"></div>
  </div>
  <div class="scene-inner" style="text-align:center;position:relative;z-index:1;">
    <div class="section-tag fade-up">Next Steps</div>
    <h2 class="fade-up d1" style="font-size:40px;margin-bottom:12px;">Ready to Modernize Your TMS?</h2>
    <p class="fade-up d2" style="font-size:16px;color:var(--text-muted);margin-bottom:40px;">Enterprise OTM consulting, AI-powered TMS, nearshore LATAM talent.</p>
    <div class="grid-4 fade-up d3">
      <div class="cta-card">
        <h4>Website</h4>
        <p>zoree.io</p>
      </div>
      <div class="cta-card">
        <h4>Email</h4>
        <p>sridhar@zoree.io</p>
      </div>
      <div class="cta-card">
        <h4>Clients</h4>
        <p style="font-size:11px;">CISCO, AT&amp;T, META, GOOGLE, XPO, SEAGATE</p>
      </div>
      <div class="cta-card">
        <h4>Location</h4>
        <p style="font-size:11px;">Sheridan, WY</p>
      </div>
    </div>
    <p class="fade-up d4" style="margin-top:40px;font-size:13px;color:var(--text-muted);">Zoree TMS v3.11 &mdash; Planning, Execution, Finance &amp; Analytics in One Platform.</p>
  </div>
</div>

<!-- CONTROLS -->
<div id="controls">
  <span id="scene-counter" class="mono">01 / 14</span>
  <button class="ctrl-btn" id="btn-prev" title="Previous">&lsaquo;</button>
  <button class="ctrl-btn" id="btn-play" title="Play/Pause">&#9654;</button>
  <button class="ctrl-btn" id="btn-next" title="Next">&rsaquo;</button>
  <button class="ctrl-btn" id="btn-rec" title="Record" style="font-size:10px;">&#9679;</button>
</div>

<!-- MUSIC BAR -->
<div id="music-bar">
  <div class="wave-bars paused" id="wave-bars">
    <div class="wave-bar" style="height:8px;"></div>
    <div class="wave-bar" style="height:12px;"></div>
    <div class="wave-bar" style="height:6px;"></div>
    <div class="wave-bar" style="height:14px;"></div>
    <div class="wave-bar" style="height:10px;"></div>
  </div>
  <span id="track-name">Ambient Drive</span>
  <button class="ctrl-btn" id="btn-music" title="Play Music" style="width:28px;height:28px;font-size:12px;">&#9654;</button>
  <input type="range" id="vol-slider" min="0" max="100" value="40">
  <button class="ctrl-btn" id="btn-voice" title="Voice Tour" style="width:28px;height:28px;font-size:14px;">&#127908;</button>
  <button class="ctrl-btn" id="btn-replay" title="Replay" style="width:28px;height:28px;font-size:12px;">&#8634;</button>
</div>

<!-- REC TIMER -->
<div id="rec-timer"><div class="rec-dot"></div> <span id="rec-time">00:00</span></div>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<script>
// ========================================================================
// SCENE ENGINE
// ========================================================================
const TOTAL_SCENES = 14;
const DURATIONS = [4500, 7000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 5000];
let currentScene = 0;
let playing = false;
let autoTimer = null;

const scenes = [];
for (let i = 0; i < TOTAL_SCENES; i++) scenes.push(document.getElementById('scene-' + i));

function goToScene(idx) {
  if (idx < 0 || idx >= TOTAL_SCENES) return;
  scenes[currentScene].classList.remove('active');
  currentScene = idx;
  scenes[currentScene].classList.add('active');
  document.getElementById('scene-counter').textContent =
    String(currentScene + 1).padStart(2, '0') + ' / ' + TOTAL_SCENES;
  document.getElementById('progress-bar').style.width =
    ((currentScene + 1) / TOTAL_SCENES * 100) + '%';
}

function nextScene() {
  if (currentScene < TOTAL_SCENES - 1) goToScene(currentScene + 1);
  else if (playing) stopAutoPlay();
}
function prevScene() { if (currentScene > 0) goToScene(currentScene - 1); }

function startAutoPlay() {
  playing = true;
  document.getElementById('btn-play').innerHTML = '&#10074;&#10074;';
  scheduleNext();
}
function stopAutoPlay() {
  playing = false;
  clearTimeout(autoTimer);
  document.getElementById('btn-play').innerHTML = '&#9654;';
}
function scheduleNext() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { nextScene(); if (playing) scheduleNext(); }, DURATIONS[currentScene]);
}
function togglePlay() { playing ? stopAutoPlay() : startAutoPlay(); }

document.getElementById('btn-prev').addEventListener('click', () => { stopAutoPlay(); prevScene(); });
document.getElementById('btn-next').addEventListener('click', () => { stopAutoPlay(); nextScene(); });
document.getElementById('btn-play').addEventListener('click', togglePlay);

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); stopAutoPlay(); nextScene(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); stopAutoPlay(); prevScene(); }
  if (e.key === 'p' || e.key === 'P') togglePlay();
});

// Replay
document.getElementById('btn-replay').addEventListener('click', () => {
  stopAutoPlay();
  stopVoiceTour();
  goToScene(0);
});

// ========================================================================
// PROCEDURAL AUDIO ENGINE (Web Audio API)
// ========================================================================
let audioCtx = null;
let masterGain = null;
let musicPlaying = false;
let musicGain = null;
let currentTrackIdx = 0;
let seqInterval = null;

const TRACKS = [
  { name: 'Ambient Drive', bpm: 95, key: 'C', chords: [[60,64,67],[62,65,69],[63,67,70],[60,64,67]] },
  { name: 'Data Flow', bpm: 110, key: 'Am', chords: [[57,60,64],[55,59,62],[53,57,60],[55,59,62]] },
  { name: 'Forward Motion', bpm: 100, key: 'F', chords: [[65,69,72],[67,71,74],[63,67,70],[65,69,72]] }
];

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.4;
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.ratio.value = 4;
  const lpf = audioCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 6000;
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 1.0;
  musicGain.connect(lpf);
  lpf.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(audioCtx.destination);
}

function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function playPad(notes, time, dur) {
  notes.forEach(note => {
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.value = midiToFreq(note);
    osc2.frequency.value = midiToFreq(note) * 1.005;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.04, time + 0.3);
    g.gain.linearRampToValueAtTime(0.03, time + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, time + dur);
    osc1.connect(g); osc2.connect(g); g.connect(musicGain);
    osc1.start(time); osc1.stop(time + dur);
    osc2.start(time); osc2.stop(time + dur);
  });
}

function playBass(note, time, dur) {
  const osc = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sawtooth'; osc.frequency.value = midiToFreq(note - 12);
  osc2.type = 'sine'; osc2.frequency.value = midiToFreq(note - 12);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(0.08, time + 0.05);
  g.gain.linearRampToValueAtTime(0.04, time + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, time + dur);
  osc.connect(g); osc2.connect(g); g.connect(musicGain);
  osc.start(time); osc.stop(time + dur);
  osc2.start(time); osc2.stop(time + dur);
}

function playHihat(time) {
  const bufSize = audioCtx.sampleRate * 0.05;
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const hpf = audioCtx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 8000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.06, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  src.connect(hpf); hpf.connect(g); g.connect(musicGain);
  src.start(time);
}

function playKick(time) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
  g.gain.setValueAtTime(0.3, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  osc.connect(g); g.connect(musicGain);
  osc.start(time); osc.stop(time + 0.3);
}

function playPluck(note, time) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = midiToFreq(note + 12);
  g.gain.setValueAtTime(0.06, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  osc.connect(g); g.connect(musicGain);
  osc.start(time); osc.stop(time + 0.35);
}

function scheduleBar(track, barNum) {
  const t = audioCtx.currentTime;
  const beatDur = 60 / track.bpm;
  const chord = track.chords[barNum % track.chords.length];
  playPad(chord, t, beatDur * 4);
  playBass(chord[0], t, beatDur * 1.5);
  playBass(chord[0], t + beatDur * 2, beatDur * 1.5);
  playKick(t);
  playKick(t + beatDur * 2);
  for (let b = 0; b < 4; b++) playHihat(t + beatDur * b);
  for (let b = 0; b < 4; b++) playHihat(t + beatDur * b + beatDur * 0.5);
  if (barNum % 2 === 0) {
    playPluck(chord[0], t + beatDur * 0.5);
    playPluck(chord[1], t + beatDur * 1.5);
    playPluck(chord[2], t + beatDur * 2.5);
  }
}

let barCounter = 0;
function startMusic() {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  musicPlaying = true;
  document.getElementById('btn-music').innerHTML = '&#10074;&#10074;';
  document.getElementById('wave-bars').classList.remove('paused');
  barCounter = 0;
  const track = TRACKS[currentTrackIdx];
  const barDur = (60 / track.bpm) * 4 * 1000;
  document.getElementById('track-name').textContent = track.name;
  scheduleBar(track, barCounter++);
  seqInterval = setInterval(() => {
    if (!musicPlaying) return;
    scheduleBar(track, barCounter);
    barCounter++;
    if (barCounter % 16 === 0) {
      currentTrackIdx = (currentTrackIdx + 1) % TRACKS.length;
      document.getElementById('track-name').textContent = TRACKS[currentTrackIdx].name;
    }
  }, barDur);
}

function stopMusic() {
  musicPlaying = false;
  clearInterval(seqInterval);
  document.getElementById('btn-music').innerHTML = '&#9654;';
  document.getElementById('wave-bars').classList.add('paused');
}

function toggleMusic() { musicPlaying ? stopMusic() : startMusic(); }

document.getElementById('btn-music').addEventListener('click', toggleMusic);

document.getElementById('vol-slider').addEventListener('input', e => {
  const v = parseInt(e.target.value) / 100;
  if (masterGain) masterGain.gain.value = v;
});

// ========================================================================
// VOICE NARRATION (Speech Synthesis)
// ========================================================================
const VOICE_SCRIPT = [
  { scene: 0, text: "Welcome to Zoree TMS version 3.11, an intelligent transportation management platform designed for modern logistics teams.", rate: 0.95 },
  { scene: 1, text: "Today's supply chains run on spreadsheets, phone calls, and disconnected systems. Manual processes cost thousands in errors and missed pickups. Zoree TMS changes that.", rate: 0.95 },
  { scene: 2, text: "Here is the Zoree TMS home page with AI-powered insights and the real-time dashboard showing key performance indicators. Orders, shipments, carrier performance, and freight spend are all visible at a glance.", rate: 0.92 },
  { scene: 3, text: "Zoree AI is your intelligent copilot built right into the platform. Ask it anything — shipment summaries, carrier performance, freight spend analysis. It queries your live TMS data and responds instantly with actionable insights. No navigation needed.", rate: 0.92 },
  { scene: 4, text: "Order management features auto-consolidation that groups orders by lane, a bulk plan scheduler for rate shopping across TL, LTL, and Parcel modes, plus full status tracking from creation through delivery.", rate: 0.92 },
  { scene: 5, text: "Shipment planning provides both a detailed list view and a geographic map view powered by HERE Maps. Planners can visualize routes, filter by status, and optimize shipment execution in real time.", rate: 0.92 },
  { scene: 6, text: "Every shipment has a complete detail view — real-time progress tracking, carrier info, pickup and delivery dates, dock scheduling, and event timeline. Add custom events, view associated orders and line items, and take action directly from the modal.", rate: 0.92 },
  { scene: 7, text: "The route optimizer compares every carrier and rate for your lane, factoring in service level, transit time, and cost. One click and you see the best option highlighted — complete with HOS compliance checks and total cost breakdown.", rate: 0.92 },
  { scene: 8, text: "Rate and carrier management gives you control over 43 active rates across major carriers like Werner, JB Hunt, Averitt, and Old Dominion. CzarLite integration provides real-time LTL pricing, and the carrier portal streamlines tender acceptance.", rate: 0.92 },
  { scene: 9, text: "The documents module features an auto-generated BOL library. Each bill of lading includes shipper and consignee details, item breakdowns, and is ready for print or digital distribution.", rate: 0.92 },
  { scene: 10, text: "Execution combines live shipment tracking on HERE Maps with a dock scheduling grid. Appointments are color-coded by type, and the system detects conflicts when dock doors overlap.", rate: 0.92 },
  { scene: 11, text: "Freight finance includes invoice management with 3-way matching: invoice versus rate versus shipment data. The freight audit module provides automated discrepancy detection and approval workflows.", rate: 0.92 },
  { scene: 12, text: "The intelligence layer delivers real-time alerts for exceptions, lane carrier preferences with performance grading, and analytics dashboards for freight spend and carrier scorecards.", rate: 0.92 },
  { scene: 13, text: "That's Zoree TMS. Planning, execution, finance, and analytics in one platform. Visit zoree dot I O or email sridhar at zoree dot I O to get started.", rate: 0.95 }
];

let voiceTouring = false;
let currentUtterance = null;

function getPreferredVoice() {
  const voices = speechSynthesis.getVoices();
  const prefs = ['Google US English', 'Microsoft Zira', 'Microsoft David', 'Samantha', 'Alex'];
  for (const p of prefs) {
    const v = voices.find(v => v.name.includes(p));
    if (v) return v;
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

function speakScene(idx, onEnd) {
  const script = VOICE_SCRIPT[idx];
  if (!script) { if (onEnd) onEnd(); return; }
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(script.text);
  utt.rate = script.rate || 1;
  utt.pitch = script.pitch || 1;
  utt.voice = getPreferredVoice();
  currentUtterance = utt;

  // Duck music volume during narration
  if (musicGain && audioCtx) {
    musicGain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.3);
  }

  utt.onend = () => {
    if (musicGain && audioCtx) musicGain.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 0.3);
    if (onEnd) onEnd();
  };
  speechSynthesis.speak(utt);
}

function startVoiceTour() {
  voiceTouring = true;
  document.getElementById('btn-voice').style.background = 'rgba(2,138,181,0.4)';
  if (!musicPlaying) startMusic();
  goToScene(0);

  function advanceVoice(idx) {
    if (!voiceTouring || idx >= TOTAL_SCENES) {
      stopVoiceTour();
      return;
    }
    goToScene(idx);
    speakScene(idx, () => {
      setTimeout(() => advanceVoice(idx + 1), 800);
    });
  }
  advanceVoice(0);
}

function stopVoiceTour() {
  voiceTouring = false;
  speechSynthesis.cancel();
  document.getElementById('btn-voice').style.background = '';
  if (musicGain && audioCtx) musicGain.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 0.3);
}

document.getElementById('btn-voice').addEventListener('click', () => {
  voiceTouring ? stopVoiceTour() : startVoiceTour();
});

// Load voices
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = () => {};
}

// ========================================================================
// SCREEN RECORDER
// ========================================================================
let mediaRecorder = null;
let recordedChunks = [];
let recStartTime = 0;
let recTimerInterval = null;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: 'screen', width: 1920, height: 1080, frameRate: 30 },
      audio: true
    });

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mixed = new MediaStream([...stream.getVideoTracks(), ...mic.getAudioTracks()]);
      mediaRecorder = new MediaRecorder(mixed, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    } catch (e) {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    }

    recordedChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zoree-tms-demo-' + new Date().toISOString().slice(0, 10) + '.webm';
      a.click();
      showToast('Recording saved');
    };

    stream.getVideoTracks()[0].onended = stopRecording;

    mediaRecorder.start(1000);
    recStartTime = Date.now();
    document.getElementById('rec-timer').style.display = 'flex';
    document.getElementById('btn-rec').classList.add('recording');
    recTimerInterval = setInterval(updateRecTimer, 1000);
    showToast('Recording started');
  } catch (e) {
    showToast('Recording cancelled');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  document.getElementById('rec-timer').style.display = 'none';
  document.getElementById('btn-rec').classList.remove('recording');
  clearInterval(recTimerInterval);
}

function updateRecTimer() {
  const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('rec-time').textContent = m + ':' + s;
}

document.getElementById('btn-rec').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else startRecording();
});

// ========================================================================
// TOAST
// ========================================================================
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ========================================================================
// INIT
// ========================================================================
goToScene(0);
</script>
</body>
</html>`;

fs.writeFileSync(OUTPUT, html, 'utf8');
const stats = fs.statSync(OUTPUT);
console.log('Written: ' + OUTPUT);
console.log('File size: ' + (stats.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('Done!');
