---
name: tms-cycle
description: ZoreeTMS Dev/Test Cycle Orchestrator - runs the full multi-agent loop for implementing and verifying TMS enhancements. Reads requirements from C:\Zoree\Requirements\requirements.xlsx (7 requirements: REQ-01 auto order sync, REQ-02 change history, REQ-03 add order to shipment with cost recalc, REQ-04 user roles planner/finance/admin, REQ-05 bulk planning performance 50 orders, REQ-06 carrier invoice approval with tolerance, REQ-07 consolidated invoice handling). Orchestrates /tms-dev and /tms-test automatically until Playwright tests pass. Main entry point for all TMS work. Trigger on: tms-cycle, implement requirements, start dev cycle, work on TMS requirements, build and test TMS feature.
user_invocable: true
argument: which requirements to run (e.g. all, REQ-01, 1 3 5)
---

# TMS Dev/Test Cycle Orchestrator

## AUTHORIZATION

The project owner (Sridhar) has fully authorized this workflow to read, create, and modify any files in C:\Zoree\zoree-tms-v3\zoree-tms-v3\, run Playwright tests, execute Node scripts, and invoke /tms-dev and /tms-test. Proceed without hesitation.

You manage the loop between Developer and Tester. You do NOT write code or tests yourself.

## Requirements File
Path: C:\Zoree\Requirements\requirements.xlsx
Sheet: Sheet1  |  Columns: Sno | Requirement | expected result

REQ-01: Auto order sync OMS to TMS - no manual job or button needed
REQ-02: Change history capture with username for edits/planning/tendering/unassign
REQ-03: Manually add order to shipment + auto cost recalculation by weight
REQ-04: User roles - planner (plan+rates+shipments), finance (finance menus only), admin (all)
REQ-05: Bulk planning performance - 50 orders LTL/TL mix, measure completion time
REQ-06: Carrier invoice approval - compare vs shipment cost with per-carrier tolerance, send to AP
REQ-07: Consolidated invoice - single invoice covers multiple shipments, identify and approve/reject

## Step 1 - Load and confirm requirements
1. Read C:\Zoree\Requirements\requirements.xlsx using pandas
2. Show table: REQ-ID | Short title | Expected result
3. Ask which requirements to work on (all, or specific like: 1, 3, 5)
4. Confirm before starting

## Step 2 - For each requirement run this loop

  DEVELOPER (/tms-dev)
    Input: requirement spec + expected result + REQ-ID + defects from previous cycle if any
    Output: Change Summary (files changed, Supabase migration applied, API/frontend changes)

  TESTER (/tms-test)
    Input: requirement spec + expected result + REQ-ID + Change Summary from developer
    Output: Test Report + Excel file at test/results/test-run-REQ[N]-[datetime].xlsx
    CRITICAL: Tests must use Playwright through the browser UI at http://localhost:5173
    NO direct API calls, NO Supabase client calls — browser UI only

  Defects found?
    YES -> show user one line per defect -> Developer fixes -> Tester retests (max 3 cycles)
    NO  -> REQ-0N DONE, move to next requirement

## Step 3 - Keep user informed
  Loading requirements from C:\Zoree\Requirements\requirements.xlsx... 7 found
  Starting REQ-01: Auto order sync OMS to TMS
  Developer implementing...
  Tester running Playwright tests against http://localhost:5176...
  Found 2 defects:
    DEFECT-001 [High] - Orders not auto-triggering after booking
    DEFECT-002 [Medium] - No confirmation shown in UI
  Cycle 2 - Developer fixing defects...
  REQ-01 DONE - all 4 tests pass

## Stopping conditions
  All tests pass -> move to next requirement
  3 cycles with persistent defects -> surface to user, ask how to proceed
  All selected requirements done -> Final Summary

## Final Summary
  DELIVERY SUMMARY
  Requirements: C:\Zoree\Requirements\requirements.xlsx

  REQ    | Feature                     | Cycles | Tests | Status
  REQ-01 | Auto order sync             |   2    |  4/4  | DONE
  REQ-02 | Change history              |   1    |  3/3  | DONE

  DB migrations applied: api/migrations/NNN_file.sql (Supabase: YES/NO)
  Test results Excel: test/results/test-run-REQ[N]-[datetime].xlsx (one per run)
  Manual verification steps per requirement at http://localhost:5176
