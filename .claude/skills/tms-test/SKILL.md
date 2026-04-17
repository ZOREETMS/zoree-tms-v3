---
name: tms-test
description: ZoreeTMS Tester Agent - writes and runs Playwright end-to-end tests against http://localhost:5176 for all 7 TMS requirements (REQ-01 through REQ-07). Has baked-in acceptance criteria per requirement from requirements.xlsx. Saves color-coded pass/fail results to Excel after every run. Trigger on: test, verify, validate, tms-test, run tests, or when handed a Change Summary from the developer.
user_invocable: true
argument: REQ-ID to test (e.g. REQ-01)
---

# TMS Tester Agent

## CRITICAL RULE — FRONTEND ONLY
ALL tests MUST go through the browser UI using Playwright. No exceptions.

- NEVER call API endpoints directly (no fetch, no axios, no curl, no HTTP calls in tests)
- NEVER use Supabase client directly in tests
- NEVER bypass the UI to seed or verify data via API
- Every test step must use `page.goto()`, `page.click()`, `page.fill()`, `page.locator()` etc.
- If data setup is needed (e.g. creating an order), do it through the UI — navigate to the page and use the form
- Assertions must check what the USER sees in the browser, not API responses

The entire point is to verify the feature works end-to-end from the user's perspective.

Write and run Playwright end-to-end tests through the browser UI. Save results to Excel after every run.

## Environment
  Frontend URL: http://localhost:5173
  API URL: http://localhost:3010
  Test scripts location: C:\Zoree\zoree-tms-v3\zoree-tms-v3\test\
  Run command: npx playwright test (from project root C:\Zoree\zoree-tms-v3\zoree-tms-v3)
  Results Excel: test/results/test-run-REQ[N]-[YYYY-MM-DD-HHmm].xlsx
  Screenshots on failure: test/screenshots/

## Step 1 - Read inputs before writing anything
  You need: enhancement spec + expected result + REQ-ID + Change Summary from developer
  If any are missing, ask before proceeding.

## Step 2 - Acceptance criteria per requirement

REQ-01 Auto order sync OMS to TMS:
  - Create or book an order in the Orders page
  - WITHOUT clicking any additional button, navigate to TMS orders view
  - Order must appear automatically within a few seconds
  - FAIL if order only appears after a manual button click or job trigger

REQ-02 Change history capture:
  - Edit an order or shipment field, save the change
  - Open the history/audit log for that record
  - Log must show: field changed, old value, new value, timestamp, username
  - Test for: field edit, planning assign, tendering, unassign

REQ-03 Add order to shipment + cost recalculation:
  - Navigate to an order, open action menu, select Add to Shipment
  - Enter a valid shipment ID and confirm
  - Verify the order now appears in the shipment order list
  - Verify the shipment total cost has been recalculated to reflect new weight

REQ-04 User roles:
  - Login as planner: can access planning/rates/shipments; finance menus are hidden
  - Login as finance user: can access finance menus; planning menus are hidden
  - Login as admin: all menus accessible
  - Attempt unauthorized action: verify access is properly denied

REQ-05 Bulk planning performance:
  - Verify 50 orders exist across different lanes (mix of LTL and TL eligible)
  - Record start time, trigger bulk plan for all 50 orders
  - Verify completion in under 2 minutes
  - Verify all 50 orders are assigned to shipments after planning

REQ-06 Invoice approval with tolerance:
  - Navigate to freight invoices or carrier invoice section
  - Submit an invoice within carrier tolerance: must be auto-approved and sent to AP
  - Submit an invoice outside carrier tolerance: must be rejected
  - Verify tolerance configuration per carrier is accessible in settings

REQ-07 Consolidated invoice handling:
  - Submit a single invoice referencing multiple shipment IDs
  - Verify TMS identifies all associated shipments
  - Verify the consolidated invoice is approved or rejected based on combined cost

## Step 3 - Write Playwright test scripts

File naming: test/REQ-[N]-[feature-name].spec.js (e.g. test/REQ-01-auto-order-sync.spec.js)

Template structure:
  const { test, expect } = require('@playwright/test');

  test.describe('REQ-01: Auto order sync', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5176');
      // login steps if needed
    });

    test('should auto-send order to TMS after booking', async ({ page }) => {
      await page.goto('http://localhost:5176/orders');
      await page.waitForLoadState('networkidle');
      // steps based on acceptance criteria above
      await expect(page.locator('...')).toBeVisible();
    });
  });

Critical patterns for this app:
  - CSS uses text-transform:uppercase everywhere - ALWAYS use case-insensitive:
      page.getByText('orders', { exact: false })
  - Always await page.waitForLoadState('networkidle') after every navigation
  - Wait for tables or lists to finish loading before asserting on their content
  - On test failure: await page.screenshot({ path: 'test/screenshots/DEFECT-NNN.png' })

## Step 4 - Run tests
  cd C:\Zoree\zoree-tms-v3\zoree-tms-v3
  npx playwright test test/REQ-[N]-*.spec.js --reporter=list

  Frontend is at http://localhost:5173 | API is at http://localhost:3010

  Capture full output - record which tests passed, which failed, and full error messages.
  If dev server not running: note as environment issue, not a test defect.

## Step 5 - Save results to Excel using /xlsx skill

Create test/results/test-run-REQ[N]-[YYYY-MM-DD-HHmm].xlsx

Sheet 1 - Test Results:
  Columns: Run Date | REQ ID | Test Name | Status | Defect ID | Defect Title |
           Steps to Reproduce | Expected | Actual | Screenshot Path | Cycle Number
  PASS rows: green background #D4EDDA, text color #155724, bold
  FAIL rows: red background #F8D7DA, text color #721C24, bold
  Header row: dark navy background #1E2D6B, white bold text
  Auto-fit column widths

Sheet 2 - Summary:
  Total Tests | Passed | Failed | Pass Rate | Run Date | REQ ID | Requirement title

Save to: C:\Zoree\zoree-tms-v3\zoree-tms-v3\test\results\ (create directory if it does not exist)

## Step 6 - Output Test Report

  ## TEST REPORT

  Requirement: REQ-0N - [title]
  Run date: [datetime]
  Results Excel: test/results/test-run-REQ[N]-[datetime].xlsx
  Total: N  |  Passed: N  |  Failed: N

  Passed Tests:
    [test name] PASS

  Defects:

    DEFECT-001
    Title: [short description]
    Severity: Critical / High / Medium / Low
    Steps to reproduce:
      1. Go to http://localhost:5176/[page]
      2. [step]
    Expected: [what should happen]
    Actual: [what actually happened]
    Screenshot: test/screenshots/DEFECT-001.png

  Environment Notes:
    [Non-defect environment issues, if any]

  Every defect must have enough detail to reproduce without any follow-up questions.
