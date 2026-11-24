# TabbedView Hooks - Developer Guide

## Overview

TabbedView provides an extensible architecture through a set of hooks that allow subclasses to customize view lifecycle behavior, validation, and lazy loading. This document describes the hook system and demonstrates its usage with CollectionView as a real-world example.

## Hook System Architecture

**Default Behavior**: Returns the view as-is (accepts all views)

### Design Principles

1. **Single Responsibility**: Each hook has one clear purpose
2. **Minimal Override**: Subclasses only override what they need to customize
3. **Consistent Lifecycle**: Hooks are called in predictable order
4. **Safe Defaults**: All hooks have sensible default implementations

## Available Hooks

### 1. `_validateView(view)`

**Purpose**: Validate and normalize a view object before adding to tabs

**Called By**: `addView()`, constructor

**Default Behavior**: Returns the view as-is (accepts all views)

**When to Override**: When you need to restrict which views can be added

**Parameters**:
- `view` - The view object being validated

**Returns**: `ViewBase|object` - the validated/normalized view object

**Example**:
```ts
_validateView(view) {
    // Only accept GraphPanelView instances or placeholder objects
    if (view.placeholder) {
        return view; // Allow placeholders
    }
    if (!(view instanceof GraphPanelView)) {
        throw new Error('CollectionView only accepts GraphPanelView instances.');
    }
    return view;
}
```

---

### 2. `_isPlaceholder(view)`

**Purpose**: Determine if a view is a placeholder that needs lazy loading

**Called By**: `selectView()`, `removeView()`, `_setMountedView()`

**Default Behavior**: Returns `false` (no placeholders)

**When to Override**: When implementing lazy loading with placeholder objects

**Parameters**:
- `view` - The view object to check

**Returns**: `boolean` - `true` if placeholder, `false` if real view

**Example**:
```ts
_isPlaceholder(view) {
    return view && typeof view === 'object' && view.placeholder === true;
}
```

**Placeholder Object Structure**:
```ts
{
    id: 'graph-123',           // Unique identifier
    title: 'Untitled Graph',   // Display name
    placeholder: true          // Marker property
}
```

---

### 3. `_onViewRequested(id, existingPlaceholder)`

**Purpose**: Load the actual view when a placeholder is selected

**Called By**: `selectView()` when user clicks placeholder tab

**Default Behavior**: Returns the placeholder unchanged

**When to Override**: When implementing lazy loading - replace placeholder with real view

**Parameters**:
- `id` - The view id that was requested
- `existingPlaceholder` - The placeholder object (if any)

**Returns**: `ViewBase|null` - the created view, or null when unavailable

**Typical Implementation**:
```ts
_onViewRequested(id, existingPlaceholder) {
    // Check if we've already created this view
    const cached = this.viewCache.get(id);
    if (cached) {
        return cached;
    }

    // Create the real view
    const realView = this._createViewForId(id);

    // Cache it
    this.viewCache.set(id, realView);

    // Replace placeholder in views array
    const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
    if (index >= 0) {
        this.views[index] = realView;
    }

    return realView;
}
```

**CRITICAL**: You **must** replace the placeholder in `this.views` with the real view so TabbedView can attach it.

---

### 4. `_shouldAttachView(view)`

**Purpose**: Decide if a view should be attached to its container

**Called By**: `_setMountedView()` during tab switching

**Default Behavior**: Attaches all views (returns `true`)

**When to Override**: When you want to defer attachment or skip certain views

**Parameters**:
- `view` - The view that might be attached

**Returns**: `boolean` - `true` to attach, `false` to skip

**Example**:
```ts
_shouldAttachView(view) {
    // Don't attach placeholders
    if (this._isPlaceholder(view)) {
        return false;
    }
    // Don't attach views that aren't fully initialized
    if (!view.isReady) {
        return false;
    }
    return true;
}
```

---

### 5. `_onViewCreated(view, id)`

**Purpose**: Perform setup after a view is created/added

**Called By**: `addView()` after view passes validation

**Default Behavior**: Does nothing

**When to Override**: When you need to:
- Subscribe to view events
- Initialize view properties
- Update external state

**Parameters**:
- `view` - The newly created view
- `id` - The view id

**Returns**: Nothing

**Example**:
```ts
_onViewCreated(view, id) {
    if (this._isPlaceholder(view)) {
        return; // Don't set up listeners for placeholders
    }

    // Subscribe to view events
    view.on('data-changed', () => this._onViewDataChanged(view));

    // Initialize view state
    view.setParentContext(this.context);
}
```

---

### 6. `_onViewRemoved(view, id)`

**Purpose**: Clean up when a view is removed

**Called By**: `removeView()` after view is detached

**Default Behavior**: Does nothing

**When to Override**: When you need to:
- Unsubscribe from events
- Update external state (e.g., remove from data model)
- Release resources

**Parameters**:
- `view` - The view being removed (already detached)
- `id` - The view id

**Returns**: Nothing

**Example**:
```ts
_onViewRemoved(view, id) {
    // Clean up cache
    if (id) {
        this.viewCache.delete(id);
    }

    // The view's event listeners are already cleaned up by detach()
}
```
## Reordering and Lazy-Loaded Tabs

Placeholders participate in reordering normally: `moveView()` only inspects ids and the views array,
so a placeholder can be moved before its real view exists. Movability is keyed by id in
`_movableById`, which means a placeholder → real-view replacement keeps its pin.

`_validateView()` must not fabricate a movability flag. Return the view/placeholder unchanged (or
normalize only its id/title); pass `movable` explicitly through `addView(..., movable)` when a tab
must be pinned.

See [TabbedView Tab Reordering](tabbed-view-reordering.md) for the movable-block invariant, drag
math and the `tab-moved` payload instead of duplicating the algorithm here.

## Complete Example: CollectionView

CollectionView extends TabbedView to provide lazy-loaded GraphPanelView tabs for a NodeGraph collection. Here's how it uses all six hooks:

```ts
class CollectionView extends TabbedView {
    constructor({ collection, workspace, viewManager, i18nService, logger }) {
        super({
            title: 'Graphs',
            tabsOnlyControl: false,
            closable: true,
            i18nService,
            logger,
        });

        this.collection = collection;
        this.workspace = workspace;
        this.viewManager = viewManager;

        // Cache loaded GraphPanelView instances
        this.graphPanelViews = new Map();

        // Subscribe to collection changes
        this._collectionChangeListener = this.collection.onChange((event) => {
            this._onCollectionChange(event);
        });
    }
    
    // HOOK 1: Validate views
    _validateView(view) {
        // Accept placeholders or GraphPanelView instances
        if (view.placeholder) {
            return true;
        }
        return view instanceof GraphPanelView;
    }
    
    // HOOK 2: Identify placeholders
    _isPlaceholder(view) {
        return view && typeof view === 'object' && view.placeholder === true;
    }
    
    // HOOK 3: Load view on demand
    _onViewRequested(id, existingPlaceholder) {
        const graph = this.collection.getGraphById(id);

        if (!graph) {
            this._log('view-requested-no-graph', { id });
            return null;
        }

        // Check cache first
        let graphPanelView = this.graphPanelViews.get(id);

        if (!graphPanelView) {
            // Create new GraphPanelView
            graphPanelView = new GraphPanelView({
                graph,
                collection: this.collection,
                workspace: this.workspace,
                viewManager: this.viewManager,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            // Cache it
            this.graphPanelViews.set(id, graphPanelView);

            this._log('graph-panel-view-created', { graphId: id });
        }

        // CRITICAL: Replace placeholder with real view
        const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
        if (index >= 0) {
            this.views[index] = graphPanelView;
        }

        return graphPanelView;
    }
    
    // HOOK 4: Skip attaching placeholders
    _shouldAttachView(view) {
        // Don't attach placeholders - they'll be replaced on selection
        return !this._isPlaceholder(view);
    }
    
    // HOOK 5: Setup after view created
    _onViewCreated(view, id) {
        if (this._isPlaceholder(view)) {
            return; // No setup needed for placeholders
        }
        
        // Subscribe to view-specific events
        this.graphPanelViews.set(id, view);
    }
    
    // HOOK 6: Cleanup when view removed
    _onViewRemoved(view, id) {
        const graphId = id || view?.graph?.id || view?.id;

        if (!graphId) {
            return;
        }

        // Remove from cache
        this.graphPanelViews.delete(graphId);

        // Unsubscribe from graph events
        const listener = this._graphChangeListeners.get(graphId);
        if (listener) {
            listener();
            this._graphChangeListeners.delete(graphId);
        }
        
        // Remove from data model
        // Note: Graph removal happens via collection APIs before removeView is called.
    }
}
```

## Lazy Loading Pattern

The lazy loading pattern is a common use case for TabbedView hooks. Here's the workflow:

### 1. Initial State - Placeholders Only

```ts
// CollectionView constructor
this.collection.getGraphArray().forEach((graph) => {
    // Add placeholder instead of full view
    const placeholder = {
        id: graph.getId(),
        title: graph.getName(),
        placeholder: true,
    };
    // Graphs are deleted from the main menu, so graph tabs are not closable.
    this.addView(placeholder, this.views.length, false, false);
});
```

**Benefits**:
- Fast initial render (no expensive view creation)
- Low memory usage (placeholders are tiny objects)
- Deferred work until needed

### 2. User Interaction - Tab Selected

```ts
// TabbedView.selectView() detects placeholder
if (this._isPlaceholder(view)) {
    const loadedView = this._onViewRequested(id, view);
    if (!loadedView) {
        return;
    }
    view = loadedView;
    this._onViewCreated(view, id);
}
```

### 3. Lazy Load - Create Real View

```ts
// CollectionView._onViewRequested()
_onViewRequested(id, existingPlaceholder) {
    const graphId = id;

    // Create GraphPanelView (expensive operation)
    const realView = new GraphPanelView({ ... });

    // Cache for future reuse
    this.graphPanelViews.set(graphId, realView);

    // Replace placeholder
    const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
    if (index >= 0) {
        this.views[index] = realView;
    }

    return realView;
}
```

### 4. Tab Switching - Reuse Cached View

```ts
// Next time user selects this tab:
// - TabbedView sees it's no longer a placeholder
// - Directly shows the cached view
// - No _onViewRequested() call needed
```

## Visibility and Container Lifecycle

TabbedView manages view visibility and container lifecycle automatically:

### Container Structure

Each view gets wrapped in a container div:

```html
<div class="tabbed-view__content">
    <!-- Container for view 0 -->
    <div class="tabbed-view__view-container" data-view-index="0">
        <!-- View 0 attached here -->
    </div>
    <!-- Container for view 1 -->
    <div class="tabbed-view__view-container" data-view-index="1">
        <!-- View 1 attached here -->
    </div>
</div>
```

### Visibility Management

When switching tabs, `_setMountedView()`:

1. **Hides inactive views**:
    ```ts
   view.container.style.display = 'none';
   if (typeof view.applyVisibilityState === 'function') {
       view.applyVisibilityState(false);
   }
   ```

2. **Shows active view**:
    ```ts
   view.container.style.display = '';
   if (typeof view.applyVisibilityState === 'function') {
       view.applyVisibilityState(true, { force: true });
   }
   ```

3. **Triggers resize**:
   ```ts
   if (typeof view.onResized === 'function') {
       const rect = view.container.getBoundingClientRect();
       view.onResized({ width: rect.width, height: rect.height });
   }
   ```

**Important**: Views are kept attached (not detached) when hidden. This preserves state and avoids expensive re-creation.

### Container Cleanup

When removing a view, TabbedView:

1. Detaches the view (calls `view.detach()`)
2. Removes the parent container div from DOM
3. Prevents orphaned containers that would cause layout issues

## Best Practices

### 1. Cache Loaded Views

```ts
// ✅ GOOD - Reuses views
this.viewCache = new Map();

_onViewRequested(id, existingPlaceholder) {
    let realView = this.viewCache.get(id);
    if (!realView) {
        realView = new ExpensiveView();
        this.viewCache.set(id, realView);
    }
    const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
    if (index >= 0) {
        this.views[index] = realView;
    }
}

// ❌ BAD - Creates new view every time
_onViewRequested(id, existingPlaceholder) {
    const realView = new ExpensiveView(); // Memory leak!
    const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
    if (index >= 0) {
        this.views[index] = realView;
    }
}
```

### 2. Clean Up Resources

```ts
// ✅ GOOD - Proper cleanup
_onViewRemoved(view, id) {
    if (id) {
        this.viewCache.delete(id);
    }
    if (this.subscriptions.has(id)) {
        this.subscriptions.get(id).unsubscribe();
        this.subscriptions.delete(id);
    }
}

// ❌ BAD - Memory leak
_onViewRemoved(view, id) {
    // No cleanup - cached views and subscriptions never released!
}
```

### 3. Handle Placeholders Correctly

```ts
// ✅ GOOD - Check before operations
_onViewCreated(view, id) {
    if (this._isPlaceholder(view)) {
        return; // Skip setup for placeholders
    }
    // Real view setup here
}

// ❌ BAD - Assumes real view
_onViewCreated(view, id) {
    view.subscribe(...); // Error: placeholder has no subscribe method!
}
```

### 4. Replace Placeholders Atomically

```ts
// ✅ GOOD - Direct array assignment
_onViewRequested(id, existingPlaceholder) {
    const realView = this._createView(id);
    const index = this.views.findIndex((view) => view.id === id || view === existingPlaceholder);
    if (index >= 0) {
        this.views[index] = realView; // Atomic replacement
    }
}

// ❌ BAD - Complex manipulation
_onViewRequested(id, existingPlaceholder) {
    const realView = this._createView(id);
    const idx = this.views.indexOf(existingPlaceholder);
    this.views.splice(idx, 1, realView); // Prone to errors
}
```

### 5. Keep Hooks Focused

```ts
// ✅ GOOD - Each hook does one thing
_validateView(view) {
    return view instanceof MyView || view.placeholder;
}

_onViewCreated(view, id) {
    if (!this._isPlaceholder(view)) {
        this._setupListeners(view);
    }
}

// ❌ BAD - Hook does too much
_validateView(view) {
    const valid = view instanceof MyView;
    if (valid) {
        this._setupListeners(view); // Wrong place!
        this._updateState(view);    // Wrong place!
    }
    return valid;
}
```

## Common Pitfalls

### 1. Forgetting to Replace Placeholder

```ts
// ❌ WRONG - Placeholder still in views array
_onViewRequested(id, existingPlaceholder) {
    const realView = new MyView();
    this.viewCache.set(id, realView);
    // Missing: this.views[index] = realView;
}
// Result: Tab shows placeholder forever
```

### 2. Attaching Placeholders

```ts
// ❌ WRONG - Tries to attach placeholder
_shouldAttachView(view) {
    return true; // Will try to attach placeholders!
}
// Result: Error when trying to call placeholder.render()

// ✅ CORRECT - Skip placeholders
_shouldAttachView(view) {
    return !this._isPlaceholder(view);
}
```

### 3. Not Cleaning Up Cache

```ts
// ❌ WRONG - Cache grows forever
_onViewRemoved(view, id) {
    // No cleanup
}
// Result: Memory leak, deleted views never garbage collected

// ✅ CORRECT - Clean up cache
_onViewRemoved(view, id) {
    if (id) {
        this.viewCache.delete(id);
    }
}
```

### 4. Circular Recursion in removeView

```ts
// ❌ WRONG - Calls own override
_onViewRemoved(view, id) {
    if (view.shouldRemoveFromModel) {
        this.removeView(view); // Calls override again!
    }
}
// Result: Stack overflow

// ✅ CORRECT - Update data model directly
_onViewRemoved(view, id) {
    if (!this._isPlaceholder(view)) {
        this.dataModel.remove(id);
    }
}
```

## Debugging

### Enable Logging

```ts
const collectionView = new CollectionView({
    collection,
    workspace,
    logger: console, // Enable built-in logging
});
```

### Common Log Messages

- `view-requested` - Placeholder tab selected, loading real view
- `view-attachment-skipped` - View not attached (probably placeholder)
- `tab-changed` - Active tab switched

### Inspection Points

```ts
// Check placeholder status
console.log('Is placeholder?', this._isPlaceholder(view));

// Check cache
console.log('Cached views:', this.viewCache.size);
console.log('Has cached?', this.viewCache.has(view.id));

// Check views array
console.log('Views array:', this.views.map(v => 
    this._isPlaceholder(v) ? `placeholder:${v.id}` : `view:${v.id}`
));
```

## Related Documentation

- [View System Architecture](view-system-architecture.md) - ViewBase lifecycle and integration
- [GraphPanelView Architecture](graph-panel-view-architecture.md) - Canvas-based view implementation
- [Data Backbone Architecture](../core/data-backbone-architecture.md) - Collection and graph data model

## Summary

The TabbedView hook system provides a flexible, extensible architecture for container views with lazy loading. Key points:

- **6 hooks** cover validation, lazy loading, attachment, creation, and removal
- **Template Method pattern** ensures consistent behavior while allowing customization
- **Lazy loading pattern** defers expensive view creation until needed
- **Visibility management** is automatic (views hidden with display:none, not detached)
- **Container lifecycle** is managed by TabbedView (creation and cleanup)

By overriding only the hooks you need, you can implement complex behaviors like lazy-loaded graph panels with minimal code and maximum maintainability.
