# Documentation Templates

---

## System / Architecture Doc

For `core/`, `view-system/`, `nodes/`, and `deployment/` docs describing a component or subsystem.

```markdown
# <Component / System Name>

## Overview

<One or two paragraphs: what this component does, why it exists, and where it sits in the system.>

## <Structure / Components>

<Describe the hierarchy or the parts that make it up. Use a tree diagram or a list.>

## <Data / Event Flow>

<How data or events move through the component. Use a step/arrow diagram when helpful.>

## Key Design Decisions

- <Decision and rationale>
- <Decision and rationale>

## References

- Link to the implementation files this doc describes (e.g. `src/micro_otter/...`)
- Link to related docs
```

---

## Contract Doc

For `firmware-compile/`, `mpy-precompilation/`, and `deployment/` docs that pin down an exact interface, packaging, or metadata schema.

```markdown
# <Contract Name> (Phase <N>)

**Status:** Implemented Contract | Draft
**Scope:** <What area this contract governs>

## Purpose

<What the contract defines and why it exists.>

## Inputs

- <Manifest / schema / config file paths the contract consumes>

## <Rules / Sections>

<The precise rules, grouped into `##` sections. Prefer bullet lists with exact paths and field names.>

## Out of Scope

- <What this contract deliberately does not cover>
```

---

## Protocol Doc

For `device-communication/` docs describing a wire/transport protocol.

```markdown
# <Protocol Name>

## Overview

<What this protocol does and where it is used.>

## Protocol Layers

### <Layer 1 name>

- <Responsibilities and key features>

### <Layer 2 name>

- ...

## <Sequence / Message Format>

<Step-by-step exchange or the message/schema shape, with code or JSON examples.>

## Error Handling

| Error condition | Behaviour |
|----------------|-----------|
| <condition> | <what happens> |

## References

- <Upstream spec or source files>
```

---

## Guide Doc

For `guides/` docs that define standards, conventions, or how-to procedures.

```markdown
# <Guide Title>

<One sentence stating the guide's purpose.>

## Goals

- <What this guide ensures>

## <Rules / Matrix>

- <The rules, conventions, or a framework matrix>

## Commands

```bash
# <what this runs>
npm run <script>
```
```

---

## `docs/dev/` Index Entry

When adding a file to a `docs/dev/` subfolder, add an entry to that folder's `index.md`:

```markdown
- **[<Title>](<filename>.md)** - <One-line description of what the doc covers.>
```

Also add the same entry to the matching category in the top-level `docs/dev/index.md`. If you added a new subfolder, update `docs/dev/README.md` and the navigation section of `docs/dev/index.md` as well.
