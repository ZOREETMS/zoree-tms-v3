const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR);

const BASE = 'http://localhost:5173';
const LOGIN_EMAIL = 'admin@zoree.io';
const LOGIN_PASS = 'Zoree@2024';

const PAGES = [
  { name: '01-home', path: '/', wait: 2000 },
  { name: '02-dashboard', path: '/dashboard', wait: 2000 },
  { name: '03-orders', path: '/orders', wait: 3000 },
  { name: '04-shipments-list', path: '/shipments', wait: 2000 },
  { name: '05-shipments-map', path: '/shipments', wait: 2000, action: 'mapView' },
  { name: '06-route-optimizer', path: '/route-optimizer', wait: 2000 },
  { name: '07-bulk-plan', path: '/bulk-plan', wait: 2000 },
  { name: '08-carrier-portal', path: '/carrier-portal', wait: 2000 },
  { name: '09-rate-management', path: '/rate-management', wait: 2000 },
  { name: '10-freight-invoices', path: '/freight-invoices', wait: 2000 },
  { name: '11-lane-preferences', path: '/lane-preferences', wait: 2000 },
  { name: '12-documents-bol', path: '/documents', wait: 2000 },
  { name: '13-bol-detail', path: '/documents', wait: 2000, action: 'viewBol' },
  { name: '14-live-tracking', path: '/live-tracking', wait: 3000 },
  { name: '15-carriers', path: '/carriers', wait: 2000 },
  { name: '16-dock-scheduling', path: '/dock-scheduling', wait: 2000 },
  { name: '17-messaging', path: '/messaging', wait: 2000 },
  { name: '18-alerts', path: '/alerts', wait: 2000 },
  { name: '19-compliance', path: '/compliance', wait: 2000 },
  { name: '20-analytics', path: '/analytics', wait: 2000 },
  { name: '21-freight-audit', path: '/freight-audit', wait: 2000 },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Login
  console.log('Logging in...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.type('input[type="email"]', LOGIN_EMAIL);
  await page.type('input[type="password"]', LOGIN_PASS);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
  ]);
  // Wait for the home page to load
  await new Promise(r => setTimeout(r, 3000));
  // Check if we're logged in by looking for sidebar
  const loggedIn = await page.$('nav, [class*="sidebar"], a[href="/orders"]');
  if (!loggedIn) {
    // Try waiting more
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('Logged in, current URL:', page.url());

  // Hide chat widgets globally
  await page.addStyleTag({
    content: `
      [class*="intercom"], [class*="crisp"], [class*="chat-widget"],
      [id*="intercom"], [id*="crisp"], [class*="claude"], [class*="Claude"],
      iframe[src*="intercom"], iframe[src*="crisp"] {
        display: none !important;
      }
    `
  });

  for (const pg of PAGES) {
    try {
      console.log(`Capturing ${pg.name} (${pg.path})...`);

      // Navigate (skip if same path and action needed)
      if (!pg.action || pg.action !== 'viewBol') {
        await page.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle2', timeout: 15000 });
      }

      // Re-inject hiding styles after navigation
      await page.addStyleTag({
        content: `
          [class*="intercom"], [class*="crisp"], [class*="chat-widget"],
          [id*="intercom"], [id*="crisp"], [class*="claude"], [class*="Claude"],
          iframe[src*="intercom"], iframe[src*="crisp"],
          div[style*="position: fixed"][style*="bottom"][style*="right"] {
            display: none !important;
          }
        `
      });

      await new Promise(r => setTimeout(r, pg.wait));

      // Handle special actions
      if (pg.action === 'mapView') {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text && text.includes('Map View')) {
            await btn.click();
            await new Promise(r => setTimeout(r, 4000));
            break;
          }
        }
      }

      if (pg.action === 'viewBol') {
        // Click first View button
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.trim() === 'View') {
            await btn.click();
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
        }
      }

      // Take screenshot
      const filepath = path.join(SCREENSHOTS_DIR, `${pg.name}.jpg`);
      await page.screenshot({ path: filepath, type: 'jpeg', quality: 90 });
      console.log(`  ✓ Saved ${filepath}`);

      // Close modal if open (for BOL detail)
      if (pg.action === 'viewBol') {
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`  ✗ Error on ${pg.name}: ${err.message}`);
    }
  }

  await browser.close();
  console.log('\nDone! All screenshots saved to:', SCREENSHOTS_DIR);
})();
