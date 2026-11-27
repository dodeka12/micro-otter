# Documentation Layers — Detailed Rules

---

## Layer 1: Reference Documentation (In-Code)

### Purpose

Reference docs are the primary resource for understanding what a symbol does without reading its implementation. They serve both human developers and agentic tools that inspect code to understand its intended use.

### Python — Google-Style Docstrings

Every public module, class, function, and method must have a docstring.

**Module docstring** (top of file):
```python
"""Short one-line summary.

Longer description if needed. Describe the module's responsibility
and how it fits into the broader system.
"""
```

**Class docstring**:
```python
class EmailProcessor:
    """Processes and summarises emails using a LangChain agent.

    Connects to the MCP email server, retrieves messages, and produces
    structured summaries via the configured Ollama model.

    Attributes:
        agent: The underlying LangChain agent instance.
        config: Runtime configuration for this processor.
    """
```

**Function/method docstring**:
```python
def fetch_emails(account: str, limit: int = 50) -> list[Email]:
    """Fetch unread emails from the given account.

    Args:
        account: The account identifier as configured in credentials.json.
        limit: Maximum number of emails to fetch. Defaults to 50.

    Returns:
        A list of Email objects sorted by received date, newest first.

    Raises:
        AccountNotFoundError: If the account identifier is not configured.
        IMAPConnectionError: If the IMAP connection cannot be established.
    """
```

**Rules:**
- First line: single sentence, imperative mood, no trailing period
- Blank line before `Args:` / `Returns:` / `Raises:` sections
- Private methods (`_name`) do not require docstrings unless behaviour is non-obvious
- Do not describe *how* — only *what*

---

### TypeScript — JSDoc

Every exported function, class, method, and interface must have a JSDoc comment.

```typescript
/**
 * Processes and summarises emails using the configured agent.
 *
 * @param accountId - The account identifier from credentials config.
 * @param options - Optional processing options.
 * @returns A promise resolving to an array of email summaries.
 * @throws {AccountNotFoundError} If the account is not configured.
 */
export async function processEmails(
    accountId: string,
    options?: ProcessOptions,
): Promise<EmailSummary[]> { ... }
```

**Rules:**
- Private fields/methods (`#name`, `_name`) do not require JSDoc unless non-obvious
- Interfaces and type aliases exported from a module must have a one-line `/** */` description

---

## Layer 2: Developer Documentation (`docs/dev/`)

### Purpose

Developer docs help human developers and agentic tools understand the **software structure and its intended use**. An agent should always read relevant developer docs *before* writing or modifying code, and the docs must be updated after structural changes.

### Folder Structure

```
docs/dev/
  README.md                 # Documentation index + contributing + standards
  index.md                  # Complete file index (all docs by category)
  guides/                   # Cross-cutting guides: coding style, testing, build, architecture overview
    index.md
    <guide>.md
  core/                     # Core systems: data model, events, i18n, logging, undo/redo, config, ADRs
    index.md
    <component>.md
  view-system/              # View architecture and UI components
    index.md
    <view-doc>.md
  nodes/                    # Node definitions, transpiler, and code generation
    index.md
    <node-doc>.md
  device-communication/     # Device protocols, WebSerial, device folder/tooling, device testing
    index.md
    <protocol>.md
  deployment/               # Deployment system, access control, and device deployment APIs
    index.md
    <deployment-doc>.md
  mpy-precompilation/       # `.mpy` precompilation workflows and compile-profile hash spec
    index.md
    <mpy-doc>.md
  firmware-compile/         # Firmware-embedded runtime compile contracts, packaging, metadata
    index.md
    <contract>.md
```

Place each doc in the subfolder that owns that area of the codebase; do not invent new top-level doc-type folders (e.g. `architecture/`, `protocols/`, `examples/`, `best-practices/`).

### What Belongs Here

| Folder | Content |
|--------|---------|
| `guides/` | Cross-cutting guides: coding style, testing, build/deployment, architecture overview |
| `core/` | Core system architectures and ADRs: data model, events, i18n, logging, undo/redo, config/version policies |
| `view-system/` | View/UI architecture, ViewBase/ViewManager, container and specialized views, styling |
| `nodes/` | Node definition schema, transpiler, webview node system, code-generation contracts |
| `device-communication/` | Transport/protocol specs (WebSerial, REPL), device folder layout, device tooling, testing |
| `deployment/` | Deployment architecture, access control, device deployment APIs, integration contracts |
| `mpy-precompilation/` | `.mpy` precompilation workflows, compile-profile hash spec |
| `firmware-compile/` | Firmware-embedded runtime compile contracts, packaging rules, metadata schemas |

### Writing Style

- Write for a reader who does not know the codebase
- Use concrete examples rather than abstract descriptions
- Keep each file focused on one topic
- Prefer short paragraphs + structured lists + code snippets over long prose
- Explain **why** not just **what**; document design decisions and trade-offs
- Link to the implementation files (source paths) the doc describes
- Use kebab-case file names
- Include a **"When to use this"** or **"Intended use"** section where applicable

### Indexing

Every subfolder has an `index.md` listing its files. When adding or renaming a file:

1. Add or update the entry in the subfolder's `index.md` using `- **[<Title>](<filename>.md)** - <description>`.
2. Add or update the matching entry in the top-level `docs/dev/index.md`.
3. If you added a new subfolder, also update `docs/dev/README.md` and the navigation section of `docs/dev/index.md`.

---

## Layer 3: User Documentation

### Purpose

User docs describe what the software does from the perspective of someone using it — not how it is built. They live in `user-docs/`, the only tree the MkDocs site renders (`uv run mkdocs build --strict`).

### What Belongs Here

- User-facing guides and how-tos (selecting targets, using features, etc.)
- If documenting commands or a public API: usage examples for each command/endpoint
- Errors a user may encounter, with resolution steps

### Rules

- No implementation details (don't mention internal module names, internal config keys, etc.)
- Every command/endpoint documented must have at least one example invocation
- Keep the audience in mind: someone using the app, not someone building it

### Adjacent Top-Level Doc Folders

Outside the three layers, the repository also keeps:

| Folder | Purpose |
|--------|---------|
| `docs/general/` | Repo/contributor setup (e.g. Git GPG signing) |
| `docs/tools/` | Tooling reference and workflows |
| `docs/workflow/` | Step-by-step how-tos |

Use these only when a change is neither developer nor user documentation.
