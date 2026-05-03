# Git hooks

Versioned git hooks for the Zoree TMS repo. These run locally on every commit
to catch corruption patterns that have hit the repo before — truncated HTML
script blocks, files ending in NUL bytes, broken JS syntax, and stray backup
files (`*.bak`, `*.corrupted-*`, `*.orig`).

## Install

The hook is wired up automatically when you run `npm install` at the repo
root (via the `prepare` script in `package.json`).

To install it manually — or to re-enable it after switching off:

```bash
git config core.hooksPath .githooks
```

To check what hook path git is currently using:

```bash
git config --get core.hooksPath
```

## Bypass

If you absolutely need to commit something the hook is rejecting — e.g.
fixing one of these very issues mid-commit — pass `--no-verify`:

```bash
git commit --no-verify -m "..."
```

Use sparingly. The hook exists because every false positive someone bypasses
without thinking is a future incident.

## What gets checked

| Check                        | Files          | What it catches                                       |
| ---------------------------- | -------------- | ----------------------------------------------------- |
| Backup-file pattern          | all            | `*.bak`, `*.corrupted-*`, `*.orig`, `*.swp`, `*~`     |
| NUL bytes in text files      | non-binary     | In-place writes that didn't truncate properly         |
| HTML `<script>` tag balance  | `*.html`       | Truncated mid-script (the OMS login bug, May 2026)    |
| JS `node --check`            | `*.js`/`*.cjs`/`*.mjs` | Syntactically broken server / build code     |

JSX/TSX are intentionally skipped — they would require Babel/TS as a hook
dependency. Source-level type & lint checks belong in CI, not in a fast hook.

## Adding a new check

Add a new `check_*` function in `.githooks/pre-commit`, give it the same
signature as the existing ones (`check_foo "$f" "$staged"`), and call it from
the loop near the bottom of the script. Keep it fast — the entire hook
should finish in well under a second on a normal commit.

## Why a shell script and not husky / lint-staged

This repo has multiple `package.json` files (root, `api/`, `frontend/`,
`mobile/`). A shell-based hook under `.githooks/` works the same regardless
of which workspace is active and doesn't need a separate `node_modules` to
boot itself — it just needs `git` and `node`, both of which any contributor
already has.
