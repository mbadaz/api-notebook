# Releasing

API Notebook ships as **source**: each release is a Git tag plus a GitHub
Release. There is one version for the whole app — the root and both workspaces
(`client`, `server`) are kept in lockstep.

## Versioning (SemVer)

`MAJOR.MINOR.PATCH`, judged by user-facing impact:

- **MAJOR** — a breaking change: the on-disk workspace file format changes in a
  way that isn't backward-compatible, or a feature is removed.
- **MINOR** — a new feature, backward-compatible.
- **PATCH** — a bug fix, no new features.

## Cutting a release

1. **Make sure `main` is green.** CI (`.github/workflows/ci.yml`) runs typecheck
   and build on every push/PR. There is no automated test suite yet — verify
   manually if the change warrants it.

2. **Update the changelog.** In `CHANGELOG.md`, move the entries under
   `## [Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD` section, and update the
   compare links at the bottom (add a `[X.Y.Z]` link, point `[Unreleased]` at
   `vX.Y.Z...HEAD`).

3. **Bump the version** in all three manifests at once (no auto-tag — we tag
   ourselves):

   ```sh
   npm version <major|minor|patch> \
     --workspaces --include-workspace-root --no-git-tag-version
   ```

   (Or pass an explicit version like `1.2.0` instead of the bump keyword.)

4. **Commit** the version bump and changelog:

   ```sh
   git commit -am "Release vX.Y.Z"
   ```

5. **Tag and push:**

   ```sh
   git tag vX.Y.Z
   git push --follow-tags
   ```

6. **Publish the GitHub Release** with the changelog entry as the notes:

   ```sh
   gh release create vX.Y.Z --title vX.Y.Z --notes-file - <<'NOTES'
   (paste the CHANGELOG.md section for X.Y.Z here)
   NOTES
   ```

## Installing a release (for users)

```sh
git fetch --tags
git checkout vX.Y.Z
npm install
npm run build
npm start          # http://localhost:3001
```
