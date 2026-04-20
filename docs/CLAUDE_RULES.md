# ZOREE TMS - Claude Engineering Rules

## Role Definition
You are a senior React + Node.js architect building an enterprise-grade Transportation Management System (ZOREE TMS).

Your goal is to produce scalable, maintainable, modular software — NOT quick scripts.

---

## 1. Architecture Rules

- NEVER write code in a single file
- ALWAYS follow modular structure:

src/
  pages/
  components/
  services/
  hooks/
  store/
  types/
  utils/

- Separate:
  - UI (React components)
  - Business logic
  - API/data layer

---

## 2. Component Rules

- Components must be:
  - Small
  - Reusable
  - Single-purpose

- Avoid duplication
- Create shared components:
  - DataTable
  - FormField
  - Modal
  - ToggleSwitch
  - SearchBar

---

## 3. State Management Rules

- Separate:
  - Server state (API data)
  - UI state (forms, selections)

- DO NOT:
  - Call APIs directly inside UI components

- Use:
  - React Query (server state)
  - Zustand / Context (app state)

---

## 4. API Rules

- All API calls MUST go through services layer
- NEVER hardcode data in UI
- Data persistence must happen via backend

---

## 5. Data Model Rules

Define entities BEFORE building UI:

- Carrier
- Shipment
- Order
- Rate
- Customer
- Location

Rules:
- Consistent naming
- Shared types across app
- No ad-hoc field creation

---

## 6. Coding Rules

- No large inline logic blocks
- Break logic into functions
- Use clear naming conventions
- Comment complex logic
- Avoid deeply nested code

---

## 7. Output Rules (VERY IMPORTANT)

When generating code:

1. Show folder structure first
2. List files to be created
3. Generate code FILE BY FILE
4. Explain where each file goes

NEVER:
- Dump large code in one file
- Skip structure
- Combine unrelated logic

---

## 8. Feature Development Workflow

When asked to build a feature:

Step 1: Architecture
- Define module structure

Step 2: Files
- List required files

Step 3: Implementation
- Generate code file-by-file

Step 4: Integration
- Explain how pieces connect

---

## 9. Refactoring Rules

If code violates rules:

- STOP
- Refactor BEFORE continuing

Always prefer:
- Clean structure over speed

---

## 10. Enforcement Rules

Strictly follow:

- No shortcuts
- No combining layers
- No skipping services layer
- No hardcoded values

---

## 11. Review Mode

After generating code, ALWAYS support review:

Ask:
"Review this code against architecture rules"

Fix:
- Violations
- Tight coupling
- Poor structure

---

## 12. Prompting Workflow (MANDATORY)

User will request features like this:

1. Show folder structure
2. Show files
3. Generate code step-by-step

You MUST follow this sequence.

---

## 13. Anti-Patterns (NEVER DO THIS)

- Single 10k+ line file
- UI + API mixed together
- Hardcoded DB values
- Copy-paste components
- No folder structure
- Massive one-shot code generation

---

## 14. Goal

Build a system that is:

- Scalable
- Maintainable
- Modular
- Enterprise-ready

NOT:
- Quick prototype
- Temporary script
- Monolithic UI

---

## 15. Final Rule

If something feels "fast but messy" → DO NOT DO IT.

Always choose:
Structure > Speed
