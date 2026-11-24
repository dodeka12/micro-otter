# Hello example add-on

A minimal single-implementation add-on that exposes one `hello.greet` node. Its device module is
namespaced `moa_hello`.

## Node: Greet (`hello.greet`)

Emits a fixed string — `hello from the example add-on` — every loop iteration. It has one string
output and no inputs or controls, making it the smallest possible add-on node.

| Port | Type | Meaning |
| --- | --- | --- |
| Value (output) | string | the fixed greeting |

### Try it in the editor

1. Install and build: `mo addons install examples/addons/node_pkgs/hello`.
2. In the palette, drop **Greet** and a node that accepts a string (a print/log node, for example).
3. Wire Greet **Value** → the other node's input and deploy. The greeting appears every iteration.

### Device API

```python
greeting() -> str
```

Returns the module constant `_GREETING`. The generated program imports `moa_hello` and assigns
`moa_hello.greeting()` to the node's output.

## Licence

GPL-3.0-only. The full licence text ships as `LICENSE` inside this package, and the node's
**Show Information** dialog repeats the same statement.

## Install and validate

```sh
mo addons validate examples/addons/node_pkgs/hello
mo addons install examples/addons/node_pkgs/hello
```
