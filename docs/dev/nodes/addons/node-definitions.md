# Node Definitions

`node_definitions.json` declares the node types an add-on contributes. The editor loads it from the
**base manifest** only — a variant manifest never carries node definitions, generators, or
capability checks, so the node set is stable across variants.

## Shape

```json
{
    "nodeTypes": {
        "greet": {
            "title": { "en": "Greet", "de": "Begrüßen" },
            "info": { "en": "Returns a fixed greeting.", "de": "Gibt einen festen Gruß zurück." },
            "category": "hello",
            "color": "#5b7fc7",
            "shape": "square",
            "executionPhase": "both",
            "outputs": [
                {
                    "id": "value",
                    "name": { "en": "Value", "de": "Wert" },
                    "outputType": "string",
                    "initialTypes": ["string"],
                    "phase": "loop"
                }
            ]
        }
    }
}
```

The node type id becomes the editor's full id as `<package-id>.<type-id>` (e.g. `hello.greet`).

## What an add-on author needs to know

- The node-definition schema is **identical** to a built-in package — inputs, outputs, controls,
  `implementations`, `requiredCapabilities`, `capabilityCheck`, `resourceUsage`, and i18n maps.
- The full schema lives in [node-definition-reference.md](../node-definition-reference.md); use it as
  the authoritative field reference rather than duplicating it here.
- Per-connector and per-control `description` fields (i18n) power the "Show Info" dialog; author them
  directly in the package, as built-ins do.
- Connector type metadata (`data_types.json`) works the same for add-ons as for built-ins.
- `icon` names an SVG inside the package's own `icons/` folder (`"icon": "icons/waving_hand_24dp.svg"`),
  exactly as a built-in does. The file travels in the package tree, so the server serves it from the
  installed add-on and `mo addons package` carries it into the archive. Download and normalization
  rules are in [adding-icons](../../../workflow/adding-icons.md); the field reference is
  [node-definition-reference.md](../node-definition-reference.md#icon-string).

## Generator wiring

A node definition does not embed code. Its `implementations`/`initImplementations` name the
generator functions that the generator file registers — see [generators.md](generators.md).
