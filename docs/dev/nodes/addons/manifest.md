# Add-on Manifest

The manifest (`manifest.json`) is the add-on's contract: it declares the package identity, the exact
set of files the package ships, and — for a package with more than one implementation — the
`variants` dict that names each implementation. It is the same schema a built-in package uses, with
the module-namespace rule layered on top (see [module-namespace.md](module-namespace.md)).

## Package fields

Declared once, at the top level:

| Field | Required | Meaning |
|-------|----------|---------|
| `manifestVersion` | yes | `2`. |
| `id` | yes | Package id — lowercase letters, digits, underscores, starting with a letter. Also the installed folder name. |
| `version` | yes | Non-empty string, used for install comparison and display. One version per package. |
| `name` | no | i18n `{en, de}` human-readable package name (palette/CLI). |
| `description` | no | i18n `{en, de}` one-line summary. |
| `author` | no | Attribution. |
| `assetsRoot` | no | `"./"` — the package folder is the asset root. |
| `nodeDefs` | no | Path to the node-definition file (default `node_definitions.json`). |
| `generators` | no | List of generator `.js` files (default `node_generators.js`). |
| `capabilityChecks` | no | Path to the capability-check file (absent = no imperative checks). |
| `dataTypes` | no | Path to the connector type metadata file (`data_types.json`). |
| `requiredCapabilities` | no | CNF gate that excludes the package from a target (see [capability-checks.md](capability-checks.md)). |
| `requiredPackages` | no | Package ids this package depends on. |
| `mpModuleRoots` | no | Module roots shared by every variant. |
| `mpyCompileProfiles` | tool-owned | Written by `mo compile-mpy`; never authored by hand. |

The package header is declared **exactly once**: `id`, `version`, `nodeDefs`, `generators`, and the
other identity fields do not repeat inside a variant.

## Variants

Every package ships exactly one `manifest.json`, whose `variants` object maps a variant id to that
implementation's metadata and files:

| Field | Required | Meaning |
|-------|----------|---------|
| `title` | no | i18n `{en, de}` label for the variant picker. |
| `description` | no | i18n `{en, de}` text used as the variant's tooltip. |
| `hardware` | no | i18n `{en, de}` text describing which hardware the variant targets. |
| `mpAssets` | yes | The variant's device files. |
| `requiredCapabilities` | no | Non-empty CNF gate the target must satisfy. |
| `precedence` | no | Display order only; a higher value sorts first in the picker. |

Every package has at least one variant. The variant id `py` names the default implementation; any
other id names an alternative. There is **no `variant` field and no `manifest.<variant>.json`**: a
legacy archive carrying one is rejected with `addon-layout-legacy-variant-manifest`.

## Module roots

`mpAssets` selects which device files ship for which node types:

```json
"variants": {
    "py": {
        "mpAssets": {
            "*": ["moa_hello/__init__.py"],
            "greet": ["moa_hello/greeting.py"]
        }
    }
}
```

The `"*"` key is the package-wide fallback; a node-type key ships additional files only when that
node type is used. Every declared path must exist in the package and its first segment must obey the
module-root rule: variant `py` → `moa_<id>`, any other variant key → `moa_<id>_<key>`.

## Validation rules

`mo addons validate` / `install` enforce, in order: a parseable JSON object; `manifestVersion: 2`; a
valid, non-conflicting id; a non-empty version; exactly one package header; a `variants` object with
at least one entry; no `manifest.<variant>.json` file in the package; variant ids that are the dict
keys and non-empty; `requiredCapabilities` may exist at package **and** variant level; confined,
existing `mpAssets` paths under the correct `moa_` root; and unique `precedence` values. Failures
carry a stable code (see [installation.md](installation.md)).

