# Changes since version 1.30.0

## New Features
- **Select by Index node** — `core.select-index` forwards one of two to eight values chosen by a
  zero-based `index`; an out-of-range index becomes `None`, while an unconnected value forwards its
  integer default (`0` unless the node stores another `inputDefaults` value).

## Bug Fixes
- **Union typing follows the active inputs** — an output's `typeInputSources` ignore inputs hidden
  by an `affectsInputs` dropdown, so raising `count` adds the newly active type to the union and
  prunes connections that type cannot reach.
