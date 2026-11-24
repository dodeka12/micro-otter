#!/usr/bin/env python3
"""Analyze test file imports and check if source files exist."""

import re
from pathlib import Path

# Project root
PROJECT_ROOT = Path(__file__).parent
TESTS_DIR = PROJECT_ROOT / "tests" / "node"
SRC_DIR = PROJECT_ROOT / "src" / "micro_otter" / "nodes"

def extract_imports(test_file_path):
    """Extract all import statements from a test file."""
    imports = []
    with open(test_file_path, encoding='utf-8') as f:
        content = f.read()

    # Match ES6 import statements
    # import { ... } from '../../path/to/file.js'
    # import name from '../../path/to/file.js'
    pattern = r"import\s+(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['\"]([^'\"]+)['\"]"
    matches = re.findall(pattern, content)

    for match in matches:
        # Skip node: imports (built-in modules)
        if match.startswith('node:'):
            continue
        # Skip third-party imports
        if not match.startswith('.') and not match.startswith('src/'):
            continue
        imports.append(match)

    return imports

def resolve_import_path(import_path, test_file_path):
    """Resolve relative import path to absolute file path."""
    # Remove leading './' or '../'
    # Start from tests/node/ directory
    test_dir = Path("tests/node")

    if import_path.startswith('../../'):
        # Goes up to project root
        relative_part = import_path[6:]  # Remove '../../'
        resolved = PROJECT_ROOT / relative_part
    elif import_path.startswith('../'):
        # Goes up one level
        relative_part = import_path[3:]  # Remove '../'
        resolved = test_dir.parent / relative_part
    elif import_path.startswith('./'):
        # Same directory
        relative_part = import_path[2:]  # Remove './'
        resolved = test_dir / relative_part
    elif import_path.startswith('src/'):
        # Absolute from project root
        resolved = PROJECT_ROOT / import_path
    else:
        # Relative without prefix
        resolved = test_dir / import_path

    return resolved

def check_file_exists(file_path):
    """Check if the file exists."""
    return file_path.exists()

def main():
    test_files = sorted(TESTS_DIR.glob("*.test.js"))

    broken_imports_tests = []
    valid_imports_tests = []

    for test_file in test_files:
        imports = extract_imports(test_file)

        if not imports:
            # No imports from source files
            valid_imports_tests.append((test_file.name, [], []))
            continue

        broken = []
        valid = []

        for imp in imports:
            resolved_path = resolve_import_path(imp, test_file)
            if check_file_exists(resolved_path):
                valid.append((imp, resolved_path))
            else:
                broken.append((imp, resolved_path))

        if broken:
            broken_imports_tests.append((test_file.name, broken, valid))
        else:
            valid_imports_tests.append((test_file.name, valid, []))

    # Print results
    print("=" * 80)
    print("TEST FILES WITH BROKEN IMPORTS (Definitely Legacy)")
    print("=" * 80)

    if not broken_imports_tests:
        print("None found!")
    else:
        for test_name, broken, valid in broken_imports_tests:
            print(f"\n{test_name}")
            print(f"  Broken imports: {len(broken)}")
            for imp, resolved in broken:
                print(f"    ❌ {imp}")
                print(f"       → {resolved}")
            if valid:
                print(f"  Valid imports: {len(valid)}")

    print("\n" + "=" * 80)
    print("TEST FILES WITH ALL VALID IMPORTS (Likely V2)")
    print("=" * 80)

    for test_name, valid, _ in valid_imports_tests:
        if valid:
            print(f"\n{test_name}")
            print(f"  Valid imports: {len(valid)}")
            for imp, _resolved in valid[:3]:  # Show first 3
                print(f"    ✓ {imp}")
            if len(valid) > 3:
                print(f"    ... and {len(valid) - 3} more")
        else:
            print(f"\n{test_name}")
            print("  No source imports found")

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total test files: {len(test_files)}")
    print(f"Tests with broken imports (legacy): {len(broken_imports_tests)}")
    print(f"Tests with all valid imports (v2): {len(valid_imports_tests)}")

if __name__ == "__main__":
    main()
