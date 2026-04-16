# ZOREE TMS - Engineering Feature Workflow Template

Use this template for feature delivery, enhancements, and refactors.

## 1) Folder Structure
List impacted modules first.

```text
src/
  pages/
  components/
  services/
  hooks/
  store/
  types/
  utils/
```

## 2) Files to Create/Update
- New files:
- Updated files:
- Deleted files (only if explicitly required):

## 3) Architecture Plan
- UI layer changes (`pages/components`):
- Business logic changes (`services/hooks/utils`):
- Data/API changes (service layer only):
- Shared types/constants:
- Reuse opportunities / deduplication:

## 4) Implementation (File-by-File)
For each file:
- Path:
- Purpose:
- Key changes:
- Dependencies/integration points:

## 5) Integration Notes
- How modules connect:
- State management split:
  - Server state (React Query)
  - UI/app state (Context/Zustand/local UI state)
- API boundary verification (no direct API calls inside UI components):

## 6) Rule Compliance Review
- [ ] No mixed layers (UI/business/data separated)
- [ ] Components are small, reusable, single-purpose
- [ ] No large inline logic blocks; extracted to services/hooks/utils
- [ ] No hardcoded persistence logic in UI
- [ ] Naming, comments, and function granularity meet standards
- [ ] No monolithic file growth

## 7) Refactor-First Check
- Existing violations found:
- Refactors completed before feature work:
- Remaining technical debt (if any):

## 8) Validation
- Lint status:
- Build/test status:
- Manual verification steps:
- Known limitations:

---

## Mandatory Output Sequence
1. Show folder structure
2. Show files to create/update
3. Implement code file-by-file
4. Explain integration points
5. Review against architecture rules and fix violations
