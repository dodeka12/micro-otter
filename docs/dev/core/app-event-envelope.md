# AppEvent Envelope Standard

This document defines the canonical internal event envelope for emitter-based events. Every emitter
in the current codebase uses `.v1` payload ids; `.v2` identifiers are illustrative only.

## Envelope shape

All internal events must emit an `AppEvent` envelope with the following top-level fields:

- `name` - event name (for example `tab-renamed`)
- `detail` - dedicated payload class instance (extends `AppPayload`)

```ts
{
    name: 'tab-renamed',
    detail: new TabbedViewTabRenamedPayload(...),
}
```

## payloadTypeId naming convention

Use this format for all payload classes:

`<EmitterClass>.<EventSemantic>.v<major>`

Examples:

- `TabbedView.TabRenamed.v1`
- `TabbedView.TabMoved.v1`
- `TabbedView.TabContextMenu.v1`
- `CollectionView.TabChanged.v1`
- `Collection.GraphMoved.v1`
- `NodeGraph.GraphChanged.v1`

Rules:

- `EmitterClass` uses PascalCase and matches the class that emits the event
- `EventSemantic` uses PascalCase and describes the event meaning
- `major` is a positive integer version
- The identifier is stored on payload instances as `payloadTypeId`

## Payload class naming convention

Each event payload must use a dedicated class declared at the top of the emitter file.

Use this class naming format:

`<EmitterClass><EventSemantic>Payload`

Examples:

- `TabbedViewTabRenamedPayload`
- `TabbedViewTabContextMenuPayload`
- `CollectionViewTabChangedPayload`
- `NodeGraphGraphChangedPayload`

## Versioning policy

`payloadTypeId` versioning follows semantic compatibility for payload shape:

- Breaking payload change: increment major (for example `v2` -> `v3`)
- Backward-compatible payload field addition: keep current major
- Payload field removal or incompatible type change: increment major

When changing versions:

- Keep old listeners in place until all consumers migrate
- Document both old and new `payloadTypeId` values during migration windows
- Remove old versions only after consumer migration is complete

## Emit pattern

```ts
import { AppPayload } from '../core/app-event.js';

class TabbedViewTabRenamedPayload extends AppPayload {
    constructor({ tabId, oldName, newName }) {
        super('TabbedView.TabRenamed.v1');
        this.tabId = tabId;
        this.oldName = oldName;
        this.newName = newName;
    }
}

this._emit('tab-renamed', new TabbedViewTabRenamedPayload({ tabId, oldName, newName }));
```

`_emit(eventName, payloadInstance)` now performs the `AppEvent` wrapping internally when
`payloadInstance` extends `AppPayload`. Do not pass `new AppEvent(...)` into `_emit`.

## Listen pattern

```ts
this.on('tab-renamed', (event) => {
    if (!(event instanceof AppEvent)) {
        return;
    }

    if (event.detail.payloadTypeId !== 'TabbedView.TabRenamed.v1') {
        return;
    }

    const payload = event.detail;
    this.handleRename(payload.tabId, payload.oldName, payload.newName);
});
```

## Scope and boundaries

- Use this envelope for internal emitter systems (`on/off/once/_emit`).
- Boundary systems that already expose browser-native APIs (`EventTarget`/`CustomEvent`) remain boundary-native.
- At boundaries, use equivalent envelope structure in `CustomEvent.detail` where practical.
