# Cutting a firmware release

The operational procedure M8 (release pipeline) and M10 (cutover) follow. A release is an
immutable `firmware-v<base>` git tag; the tag **is** the release.

## Why `firmware-v` and not `v`

The Python package version is derived by setuptools-scm/hatch-vcs from plain `v*` tags
(`v1.25.0`, …). A bare `v1.0.0` firmware tag would therefore **rewrite the package version**.
The `firmware-v` prefix keeps the two tag spaces independent — it is the single reason the prefix
is not optional.

## Steps

1. In the release commit, bump `src/micro_otter/nodes/device/firmware/release.json`:
   - `releaseVersion` → the new plain `X.Y.Z` base,
   - `kind` → `stable` or `prerelease`,
   - `tag` → `firmware-v<releaseVersion>`,
   - `releasedAtUtc` → `null` (filled by the follow-up commit, because the exact publish time is
     not known when the commit is authored).
2. Tag that commit `firmware-v<base>` and push the tag; never move or delete it.
3. Publish the image (the tag-derived identity produces exactly `<base>` at the tag).
4. In a follow-up commit, fill `releasedAtUtc` with the real ISO-8601 `Z` timestamp.

`npm run check:firmware-release` (also part of `check:ci-local`) validates `release.json` and, when
`GITHUB_REF` names a `firmware-v*` tag, asserts the tag equals `firmware-v<releaseVersion>`.

## Rules

- Never move or delete a pushed `firmware-v*` tag.
- Never bump `release.json` except when cutting a new tag.
- `release.json` is metadata, not the version source — the tag is.
