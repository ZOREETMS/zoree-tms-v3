# Git hooks

Versioned git hooks for the Zoree TMS repo. They run locally on every commit
to catch the patterns that have hurt this repo before:

- corruption (truncated HTML script blocks, NUL bytes, broken JS syntax)
- stray backup / scratch files (`*.bak`, `*.corrupted-*`, `*.orig`, `.tmp_*`)
- low-signal commit messages (the bare `bug fixes`, `wip`, `fix` epidemic
  that broke `git log --grep` and bisect)

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

### `pre-commit`

| Check                        | Files          | What it catches                                       |
| ---------------------------- | -------------- | ----------------------------------------------------- |
| Backup / scratch pattern     | all            | `*.bak`, `*.corrupted-*`, `*.orig`, `*.swp`, `*~`, `.tmp_*` |
| NUL bytes in text files      | non-binary     | In-place writes that didn't truncate properly         |
| HTML `<script>` tag balance  | `*.html`       | Truncated mid-script (the OMS login bug, May 2026)    |
| JS `node --check`            | `*.js`/`*.cjs`/`*.mjs` | Syntactically broken server / build code     |

### `commit-msg`

| Check                        | What it catches                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Empty / whitespace subject   | Commits with no subject line                                                                   |
| Bare-vague subject           | Exact-match `bug fixes`, `fix`, `wip`, `misc`, `update`, etc. — no scope, no detail            |
| Minimum length (12 chars)    | Things like `fix bug` that technically aren't on the bare list but are still useless           |

Pass-through cases (intentionally not blocked): `Merge …`, `Revert …`,
`fixup! …`, `squash! …`, `amend! …` — these are git-generated and need to
round-trip unchanged. The hook does **not** enforce conventional-commits;
it only blocks the obviously low-signal cases.

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
