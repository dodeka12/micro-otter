# Variants

A variant is an alternative implementation of the same node set. One `manifest.json` declares the
package once — `id`, `version`, `nodeDefs`, `generators`, `capabilityChecks` — and its `variants`
dict names each implementation. A package whose only implementation is not the default ships a single
`manifest.json` with one key (the built-in `audio` package does exactly that, with a single `viper`
key).

## Layout

```text
<id>/
├── manifest.json               # the only manifest — header once, plus a variants dict
├── node_definitions.json       # the node types
├── node_generators.js          # the code generator
├── moa_<id>/…                  # the py (default) device module
└── moa_<id>_<key>/…            # each alternative variant's module
```

There is exactly one manifest per package, so the merged index emits one entry per package and no
filename-parsing helper is needed.

## Names and descriptions

- Display name: `variants.<id>.title[locale]` → `variants.<id>.title.en` → the variant id.
- Tooltip: `variants.<id>.description[locale]` → … → `variants.<id>.hardware`.

## Ids

The default implementation's id is **`py`**. It matches the `Py` label; the module root stays
`moa_<id>`. A variant key may not be empty, and `py` names the default implementation (never an
alternative).

## Functional equivalence

One node-definition/generator set per package: `nodeDefs` and `generators` live at the top level, and
every variant implements exactly the same node ids, controls and IO. Support is decided by package
id, not by variant — a variant is only a different device implementation. The generated program has
no variant flag to read: only the staged module root differs between implementations.

## Selection

Selection is **explicit** — `precedence` orders the picker, it never selects:

1. The picker lists every variant key; the user chooses one.
2. The server rejects a build of a multi-variant package without an explicit choice
   (`variant-not-selected`).
3. An explicit override (`--package-variant id=name`, or the `packageVariants` frame field) picks the
   named variant and is validated server-side: an unknown id, an unsatisfiable variant, or an
   override for an unselected package is rejected (`variant-unknown`,
   `variant-capabilities-unsatisfied`, `variant-package-not-selected`).
4. A single-variant package needs no choice: it stages its one implementation.

## Example — `pulse`

```json
{
  "manifestVersion": 2,
  "id": "pulse",
  "version": "1.0.0",
  "variants": {
    "py": {
      "title": { "en": "Py", "de": "Py" },
      "mpAssets": { "*": ["moa_pulse/__init__.py"] }
    },
    "viper": {
      "title": { "en": "Viper", "de": "Viper" },
      "description": { "en": "Viper implementation.", "de": "Viper-Implementierung." },
      "hardware": { "en": "ESP32", "de": "ESP32" },
      "requiredCapabilities": ["viper"],
      "precedence": 10,
      "mpAssets": { "*": ["moa_pulse_viper/__init__.py"] }
    }
  }
}
```

See `examples/addons/node_pkgs/pulse/`.

Because the node set and its generator are shared, the generated program has no variant flag to read:
only the staged module root differs between implementations. The pulse generator therefore registers
a guarded import — `try: import moa_pulse as _moa_pulse` / `except ImportError: import
moa_pulse_viper as _moa_pulse` — and calls `_moa_pulse.high(...)`. A shared generator that must call
variant-specific device code should follow the same pattern (or re-export the API under one module
name from each variant).

