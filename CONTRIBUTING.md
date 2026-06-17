# Contributing to API Notebook

Thanks for your interest in contributing! API Notebook is an MIT-licensed,
local-first API client. Contributions of all kinds are welcome — bug reports,
feature ideas, docs, and code.

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — open an issue using the **Bug report** template.
- **Request a feature** — open an issue using the **Feature request** template.
- **Send a change** — open a pull request (see below). For anything non-trivial,
  please open an issue first so we can agree on the approach before you invest
  time.

## Development setup

You'll need **Node.js 22** (the version CI uses; 20+ should work) and npm.

```sh
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/api-notebook.git
cd api-notebook
npm install        # installs all workspaces (root + client + server)
npm run dev        # client on http://localhost:5173, API on http://localhost:3001
```

Other useful scripts (run from the repo root):

```sh
npm run typecheck  # tsc --noEmit across all workspaces
npm run build      # build server + client
npm start          # run the production build (serves the built UI + API on :3001)
```

## Project layout

This is an npm-workspaces monorepo:

- `server/` — Node + Express + TypeScript. File-based storage, the request
  execution proxy, scripting sandbox, cookie jar, and the MCP server.
- `client/` — React + Vite + TypeScript. Talks to the server via a small typed
  API client (`client/src/api.ts`).

A note specific to this repo: the request/data model is defined in **both**
`server/src/types.ts` and `client/src/types.ts` — keep the two in sync when you
change it.

## Branching model

- **Outside contributors**: fork the repo, work on a branch, and open a pull
  request against `main` (see [Pull requests](#pull-requests)).
- **Maintainers**: push small fixes directly to `main`, and use a short-lived
  feature branch for larger changes, merging to `main` once CI is green.
- `main` is **protected** — it can't be force-pushed or deleted, pull requests
  require the CI check to pass before merging, and it's kept releasable at all
  times.
- **CI runs on every push and every pull request**, so changes are always
  checked.

## Making a change

1. Create a branch off `main` (e.g. `git checkout -b fix-cookie-domain`).
2. Make your change, matching the style of the surrounding code. There's no
   separate linter/formatter — the source of truth is the TypeScript compiler.
3. Keep it green: `npm run typecheck && npm run build` must both pass.
4. There is no automated test suite yet, so **verify manually** by running the
   app (`npm run dev`) and exercising the affected paths. Describe what you did
   in the PR.
5. If your change is user-facing, add a line under `## [Unreleased]` in
   [`CHANGELOG.md`](CHANGELOG.md).
6. Update docs (README and others) when behavior or usage changes.
7. Use concise, one-line commit messages describing the change.

## Pull requests

- Open the PR against `main` and fill in the PR template.
- Keep PRs focused — one logical change per PR is much easier to review.
- **CI must pass** (it runs typecheck + build on every PR).
- You don't need to bump the version — releases are cut by the maintainer per
  [`RELEASING.md`](RELEASING.md).
- A maintainer will review; please be responsive to feedback. Small, well-scoped
  PRs get merged fastest.

## Reporting security issues

Please **don't** open a public issue for a security vulnerability. Instead, use
GitHub's private vulnerability reporting (the **Security** tab → *Report a
vulnerability*) or contact the maintainer directly.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
