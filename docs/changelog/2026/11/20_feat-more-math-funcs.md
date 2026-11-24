# Changes since version 1.31.0

## New Features
- **Math power and logarithms** — the core `math` node and the vars `array-math`
  node gain `Power`, `Natural Log`, and `Logarithm` (logarithm to a base); the
  array variants broadcast scalars and arrays, honour `clamp`, and raise
  `ValueError` for invalid domains.
- **Hyperbolic functions and n-th roots** — the core `math` node and the vars
  `array-math` node gain `Nth Root`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`,
  and `atanh`; the array variants broadcast scalars and arrays, honour `clamp`,
  and raise `ValueError` for invalid domains.
- **Arctangent** — the core `math` node and the vars `array-math` node gain
  `atan`, the single-argument inverse tangent; it converts its result to the
  selected `angleUnit`, and the array variant broadcasts scalars and arrays and
  honours `clamp`.

## Refactor
- **Shorthand math labels** — the trigonometric and hyperbolic options of the
  core `math` node and the vars `array-math` node are labelled with their
  common shorthand (`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`,
  `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`) instead of spelled-out
  names; the stored option values and the generated code are unchanged.
