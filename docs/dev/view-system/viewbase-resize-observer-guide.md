# ViewBase ResizeObserver Integration - Developer Guide

## Overview

As of the Phase 1-3 refactoring (January 2026), **all ViewBase instances have ResizeObserver enabled by default**. This means every view automatically detects when it's first sized and when it's subsequently resized. This guide documents how to leverage these capabilities when building views.

## Core Concepts

### 1. Automatic Size Detection

When a view is attached to a container via `attachTo()`, ViewBase automatically:

1. Creates a ResizeObserver for the container element
2. Monitors for the first time the container receives a non-zero size
3. Calls `onInitialSize({ width, height })` exactly once
4. Continues monitoring for subsequent size changes
5. Calls `onResized({ width, height })` whenever dimensions change
6. Cleans up the observer when `beforeDetach()` is called

**You don't need to create or manage ResizeObserver yourself.** ViewBase handles the entire lifecycle.

### 2. Lifecycle Hooks

ViewBase provides two primary hooks for resize detection:

#### `onInitialSize(size)`

Called **once** when the view's container first receives a non-zero size.

- **When:** After `attachTo()` and `render()`, when browser computes layout
- **Use for:** One-time calculations that depend on actual pixel dimensions
- **Examples:** SplitView ratio calculations, initial grid layout, canvas sizing

**Signature:**

```ts
/**
 * @param {{width: number, height: number}} size - Initial content rect size
 */
onInitialSize(size) {
    super.onInitialSize(size); // Important: Call super to emit events
    // Your initialization logic here
}
```

#### `onResized(size)`

Called on **subsequent** size changes after the initial size is detected.

- **When:** Window resize, parent container size changes, CSS layout shifts
- **Use for:** Responsive layout updates, reflow calculations, child resize propagation
- **Examples:** Tab scroll controls, responsive breakpoints, dynamic content adjustment

**Signature:**

```ts
/**
 * @param {{width: number, height: number}} size - New content rect size
 */
onResized(size) {
    super.onResized(size); // Important: Call super to emit events
    // Your resize logic here
}
```

### 3. Size Change Detection

ViewBase only calls `onResized()` when dimensions **actually change**. This prevents unnecessary processing:

```ts
// ViewBase internally tracks last size
this._lastObservedSize = { width: 0, height: 0 };

// Only fires if width OR height changed
const changed = width !== this._lastObservedSize.width || height !== this._lastObservedSize.height;

if (changed) {
    this._lastObservedSize = { width, height };
    this.onResized({ width, height });
}
```

Your code receives clean, deduplicated resize events.

---

## Common Patterns

### Pattern 1: One-Time Initial Calculation

Use `onInitialSize()` for expensive calculations that only need to run once when the view first receives dimensions.

**Example: SplitView Ratio Calculation**

```ts
class SplitView extends ViewBase {
    constructor(options) {
        super(options);
        this._panes = [];
        this._ratios = [];
    }

    onInitialSize(size) {
        super.onInitialSize(size); // Emit events for listeners

        // Calculate ratios for fixed-size panes
        // This runs ONCE when browser computes initial layout
        this._recalculateRatiosWithSpace();

        this._log('initial-size-panes-calculated', {
            width: size.width,
            height: size.height,
            ratios: this._ratios,
        });
    }

    _recalculateRatiosWithSpace() {
        const availableSpace = this._availableSpan();

        // Convert fixed pixel sizes to ratios
        this._panes.forEach((pane, i) => {
            if (pane.size && !pane.flexible) {
                this._ratios[i] = pane.size / availableSpace;
            }
        });
    }
}
```

**When to use:**

- Layout initialization that depends on pixel dimensions
- One-time grid/flexbox calculations
- Canvas sizing and context setup
- Initial responsive breakpoint detection

**Benefits:**

- Runs at the right time (after browser layout)
- Doesn't run on every resize (performance)
- Clear separation from ongoing resize handling

---

### Pattern 2: Responsive Updates

Use `onResized()` to respond to size changes with adaptive behavior.

**Example: TabbedView Scroll Controls**

```ts
class TabbedView extends ViewBase {
    constructor(options) {
        super(options);
        this._scrollPosition = 0;
    }

    onInitialSize(size) {
        super.onInitialSize(size);
        this._updateScrollControls();
        this._propagateResizeToActiveChild(size);
    }

    onResized(size) {
        super.onResized(size);
        this._updateScrollControls(); // Update on every resize
        this._propagateResizeToActiveChild(size);
    }

    _updateScrollControls() {
        // Check if tabs overflow container
        const tabsWidth = this._getTotalTabsWidth();
        const containerWidth = this._container.clientWidth;

        if (tabsWidth > containerWidth) {
            this._showScrollControls();
        } else {
            this._hideScrollControls();
        }
    }

    _propagateResizeToActiveChild(size) {
        const activeView = this._getActiveView();
        if (activeView && typeof activeView.onResize === 'function') {
            activeView.onResize(size);
        }
    }
}
```

**When to use:**

- Showing/hiding UI elements based on available space
- Responsive breakpoint transitions (mobile/tablet/desktop)
- Dynamic content reflow
- Scroll control updates

**Benefits:**

- Automatic updates when size changes
- Responsive without CSS media queries
- Precise pixel-based logic

---

### Pattern 3: Propagation to Children

Use resize hooks to notify child views when their container size changes.

**Example: Container View with Children**

```ts
class ContainerView extends ViewBase {
    constructor(options) {
        super(options);
        this._childViews = [];
    }

    addChild(view) {
        this._childViews.push(view);
        // Attach child to a section of this view's DOM
        const childContainer = this._createChildContainer();
        view.attachTo(childContainer);
    }

    onInitialSize(size) {
        super.onInitialSize(size);

        // Calculate initial layout for children
        this._layoutChildren(size);

        // Each child's ResizeObserver will handle their own sizing
        // No need to manually call child.onResize() here
    }

    onResized(size) {
        super.onResized(size);

        // Recalculate layout when container resizes
        this._layoutChildren(size);

        // Children will automatically detect their new sizes
        // via their own ResizeObserver instances
    }

    _layoutChildren(size) {
        // Calculate child positions/sizes based on container size
        const childHeight = size.height / this._childViews.length;

        this._childViews.forEach((child, index) => {
            const container = child._container;
            if (container) {
                container.style.height = `${childHeight}px`;
                // Child's ResizeObserver detects this change automatically
            }
        });
    }
}
```

**When to use:**

- Parent views that divide space among children
- Complex layout managers
- Split panes, grid layouts, flex containers

**Important note:**

- Each child view has its own ResizeObserver
- You typically **don't need** to manually call `child.onResize()`
- Changing a child's container size triggers their ResizeObserver automatically
- Only call `child.onResize()` explicitly if propagating size from external events

---

### Pattern 4: Conditional Resize Handling

Sometimes you only want to respond to certain resize conditions.

**Example: Width-Only Responsive Behavior**

```ts
class ResponsiveView extends ViewBase {
    constructor(options) {
        super(options);
        this._currentLayout = 'wide';
    }

    onInitialSize(size) {
        super.onInitialSize(size);
        this._updateLayout(size.width);
    }

    onResized(size) {
        super.onResized(size);
        // Only respond to width changes
        this._updateLayout(size.width);
    }

    _updateLayout(width) {
        let newLayout;

        if (width < 600) {
            newLayout = 'narrow';
        } else if (width < 1200) {
            newLayout = 'medium';
        } else {
            newLayout = 'wide';
        }

        // Only update if layout actually changed
        if (newLayout !== this._currentLayout) {
            this._currentLayout = newLayout;
            this._applyLayout(newLayout);
            this._log('layout-changed', { width, layout: newLayout });
        }
    }

    _applyLayout(layout) {
        switch (layout) {
            case 'narrow':
                this._container.classList.add('layout-narrow');
                this._container.classList.remove('layout-medium', 'layout-wide');
                break;
            case 'medium':
                this._container.classList.add('layout-medium');
                this._container.classList.remove('layout-narrow', 'layout-wide');
                break;
            case 'wide':
                this._container.classList.add('layout-wide');
                this._container.classList.remove('layout-narrow', 'layout-medium');
                break;
        }
    }
}
```

**When to use:**

- Responsive breakpoints (similar to CSS media queries)
- Threshold-based behavior changes
- Avoiding unnecessary work when size changes don't matter

**Benefits:**

- Efficient: Only processes when meaningful changes occur
- Clear: Explicit breakpoint values
- Flexible: Combine with CSS classes for hybrid approaches

---

### Pattern 5: Debounced Expensive Operations

For very expensive operations, debounce resize handling to avoid excessive computation.

**Example: Complex Layout with Debouncing**

```ts
class ExpensiveLayoutView extends ViewBase {
    constructor(options) {
        super(options);
        this._debounceTimer = null;
        this._debounceDelay = 150; // milliseconds
    }

    onInitialSize(size) {
        super.onInitialSize(size);
        // Run immediately on initial size
        this._performExpensiveLayout(size);
    }

    onResized(size) {
        super.onResized(size);

        // Debounce subsequent resizes
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._performExpensiveLayout(size);
        }, this._debounceDelay);
    }

    _performExpensiveLayout(size) {
        this._log('expensive-layout-start', size);

        // Complex calculations, canvas redraws, etc.
        // Only runs after resize stops for 150ms

        this._log('expensive-layout-complete', size);
    }

    beforeDetach() {
        // Clean up debounce timer
        clearTimeout(this._debounceTimer);
        super.beforeDetach();
    }
}
```

**When to use:**

- Canvas rendering operations
- Complex mathematical calculations
- Network requests triggered by size
- Any operation that takes >50ms

**Benefits:**

- Improves performance during rapid resize (window drag)
- Still responsive (150ms is imperceptible)
- Reduces unnecessary computation

**Trade-offs:**

- Adds slight delay before update
- More complex code
- Need to clean up timers in `beforeDetach()`

---

## Advanced Techniques

### Observing Custom Elements

By default, ViewBase observes `this._container` (the element passed to `attachTo()`). Sometimes you need to observe a different element.

**Example: Observing a Child Element**

```ts
class CustomObserverView extends ViewBase {
    render(container) {
        this._host = document.createElement('div');
        this._host.className = 'custom-host';

        this._content = document.createElement('div');
        this._content.className = 'scrollable-content';

        this._host.appendChild(this._content);
        container.appendChild(this._host);

        // Observe the scrollable content instead of container
        // Note: This REPLACES the default container observation
        this._setupResizeObserver(this._content);
    }

    onInitialSize(size) {
        super.onInitialSize(size);
        this._log('content-sized', size);
        // size is now from _content, not _container
    }

    onResized(size) {
        super.onResized(size);
        this._log('content-resized', size);
        // size is now from _content, not _container
    }
}
```

**When to use:**

- Observing scroll containers
- Monitoring dynamically-sized content
- Views with complex internal structure

**Important:**

- `_setupResizeObserver()` is protected (accessible in subclasses)
- Calling it replaces any existing observer
- Only one element can be observed per view instance

---

### Multiple Element Observation

If you need to observe multiple elements, create additional observers manually.

**Example: Observing Header and Content Separately**

```ts
class MultiObserverView extends ViewBase {
    constructor(options) {
        super(options);
        this._headerObserver = null;
        this._contentObserver = null;
    }

    render(container) {
        this._header = document.createElement('div');
        this._header.className = 'view-header';

        this._content = document.createElement('div');
        this._content.className = 'view-content';

        container.appendChild(this._header);
        container.appendChild(this._content);

        // ViewBase observes container automatically
        // Add custom observers for header and content
        this._observeHeader();
        this._observeContent();
    }

    _observeHeader() {
        this._headerObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { height } = entry.contentRect;
                this._onHeaderResize(height);
            }
        });
        this._headerObserver.observe(this._header);
    }

    _observeContent() {
        this._contentObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                this._onContentResize({ width, height });
            }
        });
        this._contentObserver.observe(this._content);
    }

    _onHeaderResize(height) {
        // Adjust content top position based on header height
        this._content.style.marginTop = `${height}px`;
    }

    _onContentResize(size) {
        // Update content-specific layout
        this._updateContentLayout(size);
    }

    beforeDetach() {
        // Clean up custom observers
        if (this._headerObserver) {
            this._headerObserver.disconnect();
            this._headerObserver = null;
        }
        if (this._contentObserver) {
            this._contentObserver.disconnect();
            this._contentObserver = null;
        }
        super.beforeDetach(); // Cleans up ViewBase observer
    }
}
```

**When to use:**

- Complex multi-region layouts
- Header/footer with dynamic sizing
- Sidebars that can collapse/expand

**Important:**

- You're responsible for cleaning up custom observers in `beforeDetach()`
- Use `disconnect()` not `unobserve()` for complete cleanup
- ViewBase still observes the container by default

---

## Best Practices

### 1. Always Call `super` in Hooks

Both `onInitialSize()` and `onResized()` emit events that external code may listen for. Always call the super implementation:

```ts
// ✅ CORRECT
onInitialSize(size) {
    super.onInitialSize(size); // Emits 'initialSize' event
    // Your code here
}

// ❌ WRONG - External listeners won't be notified
onInitialSize(size) {
    // Your code here
    // Missing super call!
}
```

### 2. Keep Resize Handlers Fast

ResizeObserver callbacks fire frequently during window resize. Keep your handlers efficient:

```ts
// ✅ CORRECT - Fast update
onResized(size) {
    super.onResized(size);
    if (size.width < 600) {
        this._container.classList.add('compact');
    } else {
        this._container.classList.remove('compact');
    }
}

// ❌ AVOID - Expensive operation on every resize
onResized(size) {
    super.onResized(size);
    // Recalculating entire graph on every pixel change!
    this._recalculateComplexGraph();
    this._reRenderEverything();
}
```

For expensive operations, use debouncing (see Pattern 5).

### 3. Don't Rely on Exact Timing

ResizeObserver callbacks are asynchronous and fire after layout. Don't assume immediate execution:

```ts
// ❌ WRONG - Assumes immediate size
attachTo(container) {
    super.attachTo(container);
    // this._container.clientWidth might be 0 here!
    this._doSomethingWithSize(this._container.clientWidth);
}

// ✅ CORRECT - Wait for onInitialSize
attachTo(container) {
    super.attachTo(container);
    // Don't access size here
}

onInitialSize(size) {
    super.onInitialSize(size);
    // size.width is guaranteed non-zero
    this._doSomethingWithSize(size.width);
}
```

### 4. Clean Up Resources

If you create custom observers or timers, clean them up in `beforeDetach()`:

```ts
class CleanupExample extends ViewBase {
    onResized(size) {
        super.onResized(size);
        clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this._update();
        }, 100);
    }

    beforeDetach() {
        // Clean up timer
        clearTimeout(this._timer);

        // Clean up custom observer
        if (this._customObserver) {
            this._customObserver.disconnect();
            this._customObserver = null;
        }

        // Let ViewBase clean up its observer
        super.beforeDetach();
    }
}
```

### 5. Test Edge Cases

Test your views with various size scenarios:

- **Zero size:** Container hidden with `display: none`
- **Small sizes:** Width/height < 50px
- **Rapid changes:** Window resize drag
- **Attach/detach cycles:** Memory leaks, observer cleanup

```ts
// Example test structure
describe('MyView resize handling', () => {
    test('handles initial size correctly', async () => {
        const view = new MyView();
        const container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        view.attachTo(container);

        // Wait for ResizeObserver to fire
        await waitForResize();

        expect(view.wasInitialSizeCalled).toBe(true);
        expect(view.lastSize).toEqual({ width: 800, height: 600 });

        view.beforeDetach();
        document.body.removeChild(container);
    });

    test('cleans up observer on detach', () => {
        const view = new MyView();
        const container = document.createElement('div');
        document.body.appendChild(container);

        view.attachTo(container);
        view.beforeDetach();

        // Check that observer was disconnected
        expect(view._resizeObserver).toBeNull();

        document.body.removeChild(container);
    });
});
```

---

## When NOT to Override Resize Hooks

Not every view needs custom resize handling. Skip the hooks if:

### 1. Static content with no layout calculations

**Example: Simple text view**

```ts
class SimpleTextView extends ViewBase {
    // No onInitialSize or onResized needed

    render(container) {
        const text = document.createElement('p');
        text.textContent = 'Static content';
        container.appendChild(text);
    }
}
```

ViewBase still observes the container, but you don't need to do anything with the size.

### 2. Fixed-size views

**Example: Dialog with fixed dimensions**

```ts
class DialogView extends ViewBase {
    constructor(options) {
        super({
            ...options,
            minWidth: 400,
            maxWidth: 400,
            minHeight: 300,
            maxHeight: 300,
        });
    }

    // No resize hooks needed - size is constant
}
```

### 3. CSS-only responsive behavior

**Example: View that uses CSS media queries**

```ts
class CSSResponsiveView extends ViewBase {
    render(container) {
        container.className = 'responsive-container';
        // CSS handles everything:
        // .responsive-container { ... }
        // @media (max-width: 600px) { ... }
    }

    // No custom resize handling needed
}
```

### 4. Views that only propagate to children

If you're only calling `child.onResize()` and children are ViewBase instances, you don't need to do anything—each child's ResizeObserver handles it automatically.

```ts
// ❌ Unnecessary - children have their own observers
class UnnecessaryPropagation extends ViewBase {
    onResized(size) {
        super.onResized(size);
        // Don't do this if children are ViewBase instances
        this._children.forEach((child) => child.onResize(size));
    }
}

// ✅ Better - let children's observers work
class AutomaticPropagation extends ViewBase {
    onResized(size) {
        super.onResized(size);
        // Only needed if you're changing children's container sizes
        // or children are NOT ViewBase instances
    }
}
```

---

## Migration Guide: Existing Views

If you have existing views with custom ResizeObserver implementations:

### Step 1: Remove manual observer setup

```ts
// BEFORE
class OldView extends ViewBase {
    constructor(options) {
        super(options);
        this._resizeObserver = null; // REMOVE
        this._initialSizeDetected = false; // REMOVE
    }

    render(container) {
        // ... render code ...
        this._setupResizeObserver(); // REMOVE
    }

    _setupResizeObserver() { // DELETE ENTIRE METHOD
        this._resizeObserver = new ResizeObserver(...);
        // ...
    }

    beforeDetach() {
        if (this._resizeObserver) { // REMOVE
            this._resizeObserver.disconnect();
        }
        // ... other cleanup ...
    }
}
```

### Step 2: Convert to hooks

```ts
// AFTER
class NewView extends ViewBase {
    constructor(options) {
        super(options);
        // ViewBase handles observer
    }

    render(container) {
        // ... render code ...
        // ViewBase sets up observer automatically
    }

    onInitialSize(size) {
        super.onInitialSize(size);
        // Move initial size logic here
        this._performInitialCalculations(size);
    }

    onResized(size) {
        super.onResized(size);
        // Move resize logic here
        this._updateLayout(size);
    }

    beforeDetach() {
        super.beforeDetach(); // ViewBase cleans up observer
        // ... other cleanup ...
    }
}
```

### Step 3: Test thoroughly

- Verify initial size detection still works
- Check that resize events fire correctly
- Ensure no memory leaks with attach/detach cycles
- Test with nested views

---

## Debugging Tips

### Enable ViewBase logging

```ts
const view = new MyView({
    logger: console, // ViewBase will log resize events
});
```

You'll see logs like:

```
[MyView] ResizeObserver fired { width: 800, height: 600 }
[MyView] initial-size { width: 800, height: 600 }
[MyView] ResizeObserver fired { width: 900, height: 600 }
[MyView] resized { width: 900, height: 600 }
```

### Add custom logging

```ts
onInitialSize(size) {
    super.onInitialSize(size);
    console.log('=== INITIAL SIZE ===', size);
    console.log('Available space:', this._calculateAvailableSpace());
    console.log('Children:', this._childViews.length);
}

onResized(size) {
    super.onResized(size);
    console.log('=== RESIZED ===', size);
    console.log('Change:', {
        width: size.width - this._lastObservedSize.width,
        height: size.height - this._lastObservedSize.height,
    });
}
```

### Check observer state

```ts
// In browser console
const view = /* get your view instance */;
console.log('Has observer:', view._resizeObserver !== null);
console.log('Initial size detected:', view._initialSizeDetected);
console.log('Last observed size:', view._lastObservedSize);
```

### Verify cleanup

```ts
// Check for memory leaks
const views = [];
for (let i = 0; i < 100; i++) {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new MyView();
    views.push(view);
    view.attachTo(container);
    view.beforeDetach();

    document.body.removeChild(container);
}

// Take heap snapshot in DevTools
// Search for "MyView" instances - should only find those in 'views' array
```

---

## Performance Considerations

### ResizeObserver is efficient but not free

- Each observer adds overhead
- Callbacks fire during layout phase
- Excessive DOM manipulation in callbacks can cause jank

### Optimization strategies:

1. **Keep resize handlers simple:**

```ts
// ✅ Fast
onResized(size) {
    super.onResized(size);
    this._container.classList.toggle('compact', size.width < 600);
}

// ❌ Slow
onResized(size) {
    super.onResized(size);
    this._rebuildEntireDOM();
    this._recalculateEverything();
}
```

2. **Debounce expensive operations** (see Pattern 5)

3. **Batch DOM updates:**

```ts
onResized(size) {
    super.onResized(size);

    // Batch reads
    const childHeights = this._children.map(c => c.element.offsetHeight);

    // Batch writes
    this._children.forEach((child, i) => {
        child.element.style.flexBasis = `${childHeights[i] / size.height * 100}%`;
    });
}
```

4. **Profile in DevTools:**
    - Use Performance tab
    - Record window resize
    - Look for long tasks in "ResizeObserver" entries
    - Optimize hot paths

---

## Summary

**The new ResizeObserver integration in ViewBase provides:**

- ✅ Automatic size detection for all views
- ✅ Clean lifecycle hooks: `onInitialSize()` and `onResized()`
- ✅ Consistent behavior across view hierarchy
- ✅ No manual observer management needed
- ✅ Efficient change detection (deduplicated events)
- ✅ Automatic cleanup on detach

**To use it effectively:**

1. Override `onInitialSize()` for one-time calculations
2. Override `onResized()` for ongoing responsive behavior
3. Always call `super` in your overrides
4. Keep handlers fast; debounce expensive operations
5. Clean up custom resources in `beforeDetach()`
6. Test edge cases (zero size, rapid changes, attach/detach)

**Common mistakes to avoid:**

- ❌ Not calling `super.onInitialSize()` or `super.onResized()`
- ❌ Performing expensive operations without debouncing
- ❌ Assuming size is available immediately in `attachTo()`
- ❌ Creating custom observers without cleanup
- ❌ Manually propagating to ViewBase children (unnecessary)

**When you need help:**

- Check ViewBase JSDoc comments for API details
- Review [SplitView](../../../src/micro_otter/nodes/html/js/views/split-view.ts) and [TabbedView](../../../src/micro_otter/nodes/html/js/views/tabbed-view.ts) source for real-world examples
- Enable logging with `logger: console` constructor option
- Use browser DevTools Performance tab to profile

---

## Related Documentation

- ResizeObserver Refactoring Plan - Implementation details and migration plan
- [Standard Theme Styling Guide](./standard-theme-styling-guide.md) - UI/UX styling conventions
