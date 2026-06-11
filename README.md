# API Notebook

A local-first, Git-friendly API client — like Postman, but every workspace is a
plain folder of JSON and Markdown files you can commit, diff, and share.

- **HTTP & GraphQL requests** with params, headers, body modes (JSON, text,
  form-urlencoded) and GraphQL query/variables editors.
- **Auth helpers**: Bearer token, Basic auth, API key (header or query).
- **Environments** (workspace-level) with `{{variable}}` interpolation in
  URLs, params, headers, auth fields, and bodies. The active environment is
  stored outside the workspace so it never pollutes your repo.
- **Markdown docs** on every request (stored as a sibling `.md` file, so it
  renders on GitHub) and on every collection.
- **Workspaces** are folders you choose anywhere on disk via the native
  system folder picker (or by typing a path) — collaborate by making a
  workspace a Git repo and pushing it to GitHub. On Linux the picker uses
  `zenity` or `kdialog` if installed.
- Requests are executed by the local Node server (no CORS problems), which
  returns status, headers, body, timing, and size.

## Getting started

```sh
npm install
npm run dev
```

Open http://localhost:5173. The API server runs on http://localhost:3001.

For a production-style single server (serves the built UI and the API from
one port):

```sh
npm run build
npm start          # http://localhost:3001
```

## Workspace layout on disk

```
my-workspace/
├── workspace.json              # { id, name }
├── environments/
│   └── dev.json                # { name, variables: [{ key, value, enabled }] }
└── collections/
    └── users-api/
        ├── collection.json     # { name, description }
        └── requests/
            ├── get-user.json   # method, url, params, headers, auth, body…
            └── get-user.md     # the request's Markdown docs
```

App-local state lives in `~/.apinotebook/` (the list of registered workspaces
and each workspace's active environment) — nothing machine-specific is ever
written into the workspace folder.

## Collaborating via Git

```sh
cd my-workspace
git init && git add . && git commit -m "Initial workspace"
gh repo create my-workspace --private --source . --push
```

Teammates clone the repo, then in API Notebook choose
**Open existing folder…** and point it at the clone. Pull to get changes,
commit and push to share yours. Secrets tip: keep tokens in environment
variable values and consider gitignoring `environments/*.json` if they hold
real credentials.

## Keyboard shortcuts

- `Cmd/Ctrl+Enter` — send the current request
- `Cmd/Ctrl+S` — save the current request
- `Enter` in the URL bar — send

## Stack

- `server/` — Node + Express + TypeScript. File-based storage, request
  execution proxy with variable interpolation and a 30s timeout.
- `client/` — React + Vite + TypeScript. No state library; talks to the
  server over a small typed API client (`client/src/api.ts`).
