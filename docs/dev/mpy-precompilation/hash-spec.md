# Compile Profile Hash Spec

This document defines the canonical hash algorithm for MPY compile profiles.

Use this spec for any implementation that needs to derive a compile profile hash, including Python tooling and frontend JavaScript.

## Hash Purpose

A profile hash identifies a specific compile configuration so tools can:

- Select matching `.mpy` artifacts.
- Compare runtime compatibility.
- Persist and read `mpyCompileProfiles` metadata from manifests.

## Required Inputs

The hash payload must include:

- Compile-relevant parameters (for example: emit mode, architecture, and small-int bits).
- Compiler identity/version field used by the compile pipeline.

Only values that affect output compatibility should be included.

## Canonicalization Rules

Implementations must follow all rules below exactly.

1. Build a JSON object with the agreed keys and values.
2. Sort object keys lexicographically at every object level.
3. Emit compact JSON with no extra whitespace.
4. Preserve value types exactly (number stays number, boolean stays boolean).
5. Encode JSON bytes as UTF-8.

## Digest And Truncation

1. Compute SHA-256 over the UTF-8 canonical JSON bytes.
2. Encode digest as lowercase hexadecimal.
3. Use the first 12 hex characters as the profile hash.

## Reference Pseudocode

```text
payload = canonical_json(profile_fields)
full = sha256_hex(payload)
hash = full[0:12]
```

## Determinism Requirements

- Same logical input object must produce the same hash in Python and JavaScript.
- Unknown keys must be rejected or ignored consistently by all implementations.
- Any change to included keys or value normalization is a breaking hash-spec change.

## Compatibility Policy

When this spec changes:

1. Update this document first.
2. Update Python and JavaScript implementations together.
3. Keep old hash mappings in manifests when backward compatibility is required.
