# ZOREE TMS - DB Change Output Template

Use this template for every schema or migration change request.

## 0) Change Summary
- Change title:
- Requestor:
- Date:
- Goal:
- Non-goals:

## 1) Schema Changes
- New tables:
- Modified tables:
- Columns added/changed:
- Controlled values (enum/lookup) impacted:
- Multi-tenant impact (`tenant_id`/isolation):
- Audit fields (`created_at`, `updated_at`) coverage:

## 2) Migration Files
- Forward-only migration file(s):
- Execution order:
- Deployment sequence (safe rollout steps):
- Notes on compatibility during rollout:

## 3) Backfill / Data Migration Needs
- Backfill required: Yes/No
- Data source:
- Backfill logic:
- Idempotency strategy:
- Validation queries:

## 4) Index Changes
- New indexes:
- Updated/removed indexes:
- Query patterns being optimized:
- Over-indexing risk check:

## 5) Constraint Changes
- Primary keys:
- Foreign keys:
- Unique constraints:
- Check constraints / domain validation:
- Nullability changes:

## 6) Rollback / Fallback Considerations
- Safe fallback strategy (without destructive rollback):
- Feature flag or dual-write/dual-read plan (if needed):
- Recovery plan if migration partially succeeds:

## 7) Affected APIs / Services / UI
- API endpoints impacted:
- Service-layer changes:
- UI/UX impact:
- Contract changes (request/response fields):

## 8) Risks and Assumptions
- Risks:
- Assumptions:
- Monitoring/alerts required:
- Post-deploy verification checklist:

---

## Required Safety Checklist
- [ ] No ad hoc schema changes; versioned migration files only
- [ ] Forward-only and deployment-safe migration sequence
- [ ] No destructive drop/rename without transition plan
- [ ] DB-level integrity (PK/FK/constraints) enforced
- [ ] Relational modeling normalized by default (JSON justified if used)
- [ ] Status values controlled via enum/lookup/check constraints
- [ ] Multi-tenant isolation considered
- [ ] Seed/demo data separate from production logic
