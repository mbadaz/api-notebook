# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [RELEASING.md](RELEASING.md) for the release process.

## [Unreleased]

### Added

- **Folders** inside collections, nestable to any depth (Postman-style).
  Folders carry their own description and pre-request/test scripts, which run in
  the execution chain (collection → folder(s) → request). Postman imports now
  preserve their folder structure instead of flattening it into separate
  collections. On disk, folders are mirrored as nested directories; pre-folders
  workspaces still load (their requests appear at the collection root).
- **Drag-and-drop** to move requests and folders between folders and
  collections in the sidebar (moving a folder takes its contents along).
- Documentation now has **edit** and **preview** modes (request docs and
  collection descriptions). Existing docs open in a read-only rendered preview
  with an **Edit** button; empty docs open straight in the editor; a **Done**
  button returns to preview.

## [1.0.0] - 2026-06-17

First tagged release.

### Added

- HTTP and GraphQL requests with params, headers, auth helpers (Bearer, Basic,
  API key), and body modes: JSON, text, form-urlencoded, multipart form-data
  with file fields, and binary file. Binary-safe responses with a Download
  button, plus Pretty/Raw views and syntax highlighting.
- Workspaces as plain folders of JSON/Markdown files, chosen via the native
  system folder picker; collaborate by making a workspace a Git repo.
- Workspace-level environments with `{{variable}}` interpolation, `{{var}}`
  autocomplete and blue/red highlighting, and secret variables that keep their
  value in a gitignored `<env>.local.json`.
- Markdown documentation on every request and collection, edited with a
  WYSIWYG editor that round-trips to clean Markdown.
- Resizable request-body, response, and sidebar panels with persisted sizing.
- cURL import/export and Postman collection/environment import (Collection
  v2.1.0), including import of Postman pre-request/test scripts.
- Postman-compatible pre-request and post-response (test) scripts with a `pm.*`
  API, at the request and collection level, run in a sandboxed `node:vm`.
- Automatic per-workspace cookie jar (capture and auto-attach), a cookie
  manager UI, and `pm.cookies` for scripts.
- MCP server over Streamable HTTP exposing workspace tools to AI agents, with
  two-step confirmation on destructive tools.

### Fixed

- Unsaved-changes indicator no longer sticks after edits are reverted.
- Cookies whose `Domain` attribute is an IP are stored host-only instead of
  being silently dropped.

[Unreleased]: https://github.com/mbadaz/api-notebook/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mbadaz/api-notebook/releases/tag/v1.0.0
