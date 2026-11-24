# ADR: Internal Event API Unification with AppEventEmitter

Date: 2026-02-20  
Status: Accepted

## Context

The v2 codebase historically used multiple internal event API variants:

- `emit(...)` and `_emit(...)`
- `on(...)` and `onChange(...)`
- mixed listener expectations across subsystems

In parallel, event payloads are being standardized around `AppEvent` + `AppPayload` with explicit `payloadTypeId` contracts.

The team needed one internal API direction that reduces migration friction while preserving stable external/boundary contracts.

## Decision

Adopt a shared internal base class, `AppEventEmitter`, for internal app-domain emitters.

Canonical internal API:

- `emit(eventName, payloadInstance)`
- `on(eventName, listener)`
- `off(eventName, listener)`
- `once(eventName, listener)`

Migration compatibility policy:

- allow `_emit(...)` and `onChange(...)` as temporary compatibility aliases
- implement aliases through `AppEventEmitter` only (no ad-hoc per-class variants)
- remove aliases after all internal call sites migrate to canonical API

Payload contract policy:

- `emit(...)` accepts payload instances derived from `AppPayload`
- envelope emitted to listeners is `AppEvent`
- listeners are expected to fail fast on incompatible `payloadTypeId` or invalid required fields

## Scope boundary

Use `AppEventEmitter` for internal app-domain emitters.

Keep `EventTarget`/`CustomEvent` where browser-native semantics are already part of boundary-facing contracts, including:

- serial communication
- deployment subsystem boundaries
- i18n boundary events
- browser channel integration points

At those boundaries, carry equivalent structured contract data in `CustomEvent.detail` where practical.

## Consequences

Positive:

- one consistent internal API surface
- lower cognitive load for contributors
- centralized validation and fail-fast behavior
- simpler migration governance and documentation

Trade-offs:

- temporary compatibility period adds short-term complexity
- migration requires staged listener updates to avoid behavior drift

## Alternatives considered

### Full conversion to EventTarget everywhere

Rejected.

Reason: broad internal API churn with limited benefit over dedicated internal contracts; also increases risk in high fan-out internal event chains.

### Keep mixed internal APIs indefinitely

Rejected.

Reason: preserves ambiguity and inconsistency, making future maintenance and contributor onboarding harder.

## References

- [App event envelope standard](app-event-envelope.md)
- [Event payload standardization overview](../../../ldev/todos/2026-02-19-event-payload-standardization/00-overview.md)
- [View event structure spec](../../../ldev/todos/2026-02-19-event-payload-standardization/01-view-event-structure-spec.md)
- [Phase 0 full sweep inventory](../../../ldev/todos/2026-02-19-event-payload-standardization/07-phase0-inventory-full-sweep.md)
