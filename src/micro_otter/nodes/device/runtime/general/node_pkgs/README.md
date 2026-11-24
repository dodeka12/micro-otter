# Runtime-Specific Node Packages

This directory contains node packages that are specific to the `general` runtime.

## Purpose

This directory is reserved for node packages that are unique to this runtime and should not be shared globally across all runtimes. Most standard node packages should be placed in the global packages directory (`device/node_pkgs/`) instead.

## When to Use Local Packages

Use this directory for:
- Runtime-specific experimental nodes
- Custom nodes that only work with this runtime's features
- Specialized nodes that conflict with global packages
- Development/testing packages not ready for global use

## Availability

All packages listed in both the `global` and `local` lists in the runtime manifest are made available in the node palette when this runtime is active.

## Package Structure

Each package should follow the standard structure:
```
<package-name>/
├── manifest.json          # Package metadata
├── node_definitions.json  # Node type definitions
└── ...                    # Additional package files
```

## Manifest Configuration

To use local packages, add them to the runtime manifest:

```json
{
    "nodePackages": {
        "global": ["core", "stdmo"],
        "local": ["my_custom_package"]
    }
}
```

The `local` list should contain folder names (without paths) that exist in this directory.
