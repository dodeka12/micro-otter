# ViewBase Desired Size Feature Guide

## Overview

The **Desired Size** feature allows views to communicate their preferred dimensions to hosting containers like **SplitView**. This is a soft constraint that containers can use as a hint when allocating space, separate from hard min/max constraints.

**Key Difference from Constraints:**

- **Min/Max Constraints** - Hard limits that containers must respect
- **Desired Size** - Soft preferences that containers can honor when possible

**Location:** `ViewBase` class in `src/micro_otter/nodes/html/js/views/view-base.ts`

**Added:** Phase 1.4 of Settings System implementation

---

## Use Cases

### 1. Settings Panels with Natural Heights

Settings views with a fixed number of controls can request their natural content height:

```ts
class GeneralSettingsView extends ViewBase {
    render(container) {
        // Render controls
        this._renderThemeControl();
        this._renderLanguageControl();

        // Request natural height (e.g., 120px for two controls + padding)
        this.setDesiredSize({ height: 120 });
    }
}
```

SplitView can use this hint when initially distributing space among panes.

### 2. Toolbars with Fixed Heights

A toolbar with a single row can request its exact height:

```ts
class ToolbarView extends ViewBase {
    render(container) {
        const toolbar = this._createToolbar();
        container.appendChild(toolbar);

        // Request fixed height for single-row toolbar
        this.setDesiredSize({ height: 40 });
    }
}
```

### 3. Sidebar with Preferred Width

A sidebar can request a comfortable default width:

```ts
class TreeView extends ViewBase {
    render(container) {
        this._renderTree();

        // Request comfortable sidebar width
        this.setDesiredSize({ width: 250 });
    }
}
```

### 4. Dynamic Content with Calculated Size

Views with dynamic content can update their desired size after measuring:

```ts
class ContentView extends ViewBase {
    _updateContent(data) {
        this._renderContent(data);

        // Measure rendered content
        const naturalHeight = this._measureContentHeight();

        // Request size based on content
        this.setDesiredSize({ height: naturalHeight });
    }
}
```

---

## API Reference

### setDesiredSize(options)

Set or update the desired dimensions for this view.

**Parameters:**

- `options.width` (number|null) - Desired width in pixels, or null to clear
- `options.height` (number|null) - Desired height in pixels, or null to clear

**Validation:**

- Values must be finite positive numbers or null
- Zero and negative values are treated as null (no preference)
- Non-numeric values are treated as null

**Side Effects:**

- Emits `'desiredSize'` event if dimensions changed
- Event payload: `{ width: number|null, height: number|null }`

**Example:**

```ts
// Set desired width and height
this.setDesiredSize({ width: 300, height: 200 });

// Set only height
this.setDesiredSize({ height: 150 });

// Clear desired width, keep height
this.setDesiredSize({ width: null });

// Clear all desired dimensions
this.setDesiredSize({ width: null, height: null });
// or
this.setDesiredSize();
```

### getDesiredSize()

Get current desired size preferences.

**Returns:** `{ width: number|null, height: number|null }`

**Example:**

```ts
const { width, height } = this.getDesiredSize();

if (height !== null) {
    console.log(`View prefers height: ${height}px`);
}
```

### Event: 'desiredSize'

Emitted when desired dimensions change.

**Event Data:**

```ts
{
    width: number | null,
    height: number | null
}
```

**Example:**

```ts
view.on('desiredSize', ({ width, height }) => {
    console.log('View desires:', width, height);
    // Container can use this hint when resizing
});
```

---

## Implementation Details

### Internal Storage

```ts
constructor() {
    // ...
    this._desiredWidth = null;
    this._desiredHeight = null;
}
```

Desired dimensions are stored as private fields in ViewBase.

### Change Detection

```ts
setDesiredSize({ width = null, height = null } = {}) {
    const prevWidth = this._desiredWidth;
    const prevHeight = this._desiredHeight;

    this._desiredWidth = Number.isFinite(width) && width > 0 ? width : null;
    this._desiredHeight = Number.isFinite(height) && height > 0 ? height : null;

    // Only emit event if values actually changed
    if (prevWidth !== this._desiredWidth || prevHeight !== this._desiredHeight) {
        this._emit('desiredSize', {
            width: this._desiredWidth,
            height: this._desiredHeight,
        });
    }
}
```

Events are only emitted when dimensions actually change to avoid noise.

---

## Container Integration (SplitView)

SplitView can listen for desired size hints and use them during layout.

### Current SplitView Behavior

The implemented SplitView applies a `desiredSize` event to the single pane that emitted it. It does
not aggregate desired heights across panes, so desired sizes alone cannot produce a stable
“stack of content-height panes with unused space below” layout. For that use case, publish measured
`maxHeight` constraints instead (for example with `CollapsibleView.sizeToContent`), which
SplitView's constraint engine can apply to every pane in one normalization pass.

A `desiredSize` hint is **advisory**, not authoritative: `_handleDesiredSize` routes it through
`resolvePaneSizes` in `fair` mode, which caps the hint at the pane's equal share and re-equalizes the
rest (see [SplitView Sizing Solver](split-view-sizing.md)). This is what prevents a `CollapsibleView`
that restores a large `_heightBeforeCollapse` (for example after a maximize/solo) from re-claiming
all the space and pinning its siblings to their header height. Maximize/minimize/relative/drag stay
authoritative. `sizeToContent` `maxHeight` caps remain the recommended way to publish measured
heights, because they are applied to every pane in one normalization pass.

### Initial Layout

When adding views to a SplitView, use desired sizes for initial distribution:

```ts
// SplitView pseudo-code
_distributeInitialSpace(views, availableSpace) {
    const requests = views.map(v => v.getDesiredSize().height || null);
    const totalRequested = requests.filter(r => r !== null).reduce((a, b) => a + b, 0);

    if (totalRequested <= availableSpace) {
        // Honor all requests if space permits
        views.forEach((view, i) => {
            const desired = requests[i];
            if (desired !== null) {
                view.setSize(desired);
            } else {
                // Distribute remaining space among views without preferences
            }
        });
    } else {
        // Scale down proportionally if insufficient space
        const scale = availableSpace / totalRequested;
        views.forEach((view, i) => {
            const desired = requests[i];
            if (desired !== null) {
                view.setSize(Math.floor(desired * scale));
            }
        });
    }
}
```

### Dynamic Updates

Listen for desired size changes and re-layout if appropriate:

```ts
// SplitView pseudo-code
addView(view) {
    this._views.push(view);

    const unsubscribe = view.on('desiredSize', ({ width, height }) => {
        if (this._orientation === 'vertical' && height !== null) {
            this._requestRelayout({ view, desiredHeight: height });
        } else if (this._orientation === 'horizontal' && width !== null) {
            this._requestRelayout({ view, desiredWidth: width });
        }
    });

    this._cleanupFns.push(unsubscribe);
}
```

---

## Interaction with Constraints

Desired size works alongside min/max constraints:

### Constraint Priority

1. **Minimum Constraints** - Hard floor (must be respected)
2. **Maximum Constraints** - Hard ceiling (must be respected)
3. **Desired Size** - Soft target (honored when possible)

### Example Scenario

```ts
view.setSizeConstraints({
    minHeight: 50, // Hard minimum
    maxHeight: 300, // Hard maximum
});

view.setDesiredSize({ height: 120 }); // Soft preference
```

**Container Logic:**

```ts
function allocateHeight(view, availableHeight) {
    const { minHeight, maxHeight } = view;
    const { height: desiredHeight } = view.getDesiredSize();

    let targetHeight = availableHeight;

    // Apply desired size as starting point
    if (desiredHeight !== null) {
        targetHeight = desiredHeight;
    }

    // Enforce minimum constraint
    if (minHeight !== null && targetHeight < minHeight) {
        targetHeight = minHeight;
    }

    // Enforce maximum constraint
    if (maxHeight !== null && targetHeight > maxHeight) {
        targetHeight = maxHeight;
    }

    return targetHeight;
}
```

### Constraint Updates Don't Affect Desired Size

Changing constraints does not reset desired size:

```ts
view.setDesiredSize({ height: 200 }); // Desired: 200px
view.setMinHeight(100); // Min: 100px, Desired: still 200px
view.setMaxHeight(150); // Max: 150px, Desired: still 200px (but clamped to 150)
```

The desired size remains 200px, but the container will clamp to max constraint.

---

## Anti-Patterns

### ❌ Using Desired Size as Hard Constraint

```ts
// WRONG: Treating desired size like a requirement
view.setDesiredSize({ height: 200 });
// View expects exactly 200px, breaks if not given
```

**Instead:** Use min/max constraints for requirements:

```ts
// CORRECT: Use constraints for requirements
view.setSizeConstraints({
    minHeight: 200,
    maxHeight: 200,
});
```

### ❌ Setting Desired Size Without Measuring

```ts
// WRONG: Guessing a random size
view.setDesiredSize({ height: 500 }); // Why 500?
```

**Instead:** Base desired size on actual content:

```ts
// CORRECT: Measure or calculate based on content
const controlCount = this._controls.length;
const controlHeight = 30;
const padding = 20;
const naturalHeight = controlCount * controlHeight + padding;

view.setDesiredSize({ height: naturalHeight });
```

### ❌ Frequently Changing Desired Size

```ts
// WRONG: Changing desired size on every mouse move
onMouseMove() {
    this.setDesiredSize({ height: Math.random() * 500 });
}
```

**Instead:** Only update when content meaningfully changes:

```ts
// CORRECT: Update only when adding/removing content
addItem(item) {
    this._items.push(item);
    this._render();

    // Recalculate desired size after content change
    const newHeight = this._calculateNaturalHeight();
    this.setDesiredSize({ height: newHeight });
}
```

### ❌ Forgetting Container Support is Optional

```ts
// WRONG: Assuming desired size will always be honored
view.setDesiredSize({ height: 200 });
// Code breaks if view is sized differently
```

**Instead:** Handle any size gracefully:

```ts
// CORRECT: Use desired size as hint, handle any actual size
view.setDesiredSize({ height: 200 }); // Hint to container

onResized({ height }) {
    // Adapt layout to whatever size we actually got
    if (height < 150) {
        this._useCompactLayout();
    } else {
        this._useNormalLayout();
    }
}
```

---

## Real-World Example: CollapsibleView

CollapsibleView uses desired size when collapsing to header-only view:

```ts
class CollapsibleView extends ViewBase {
    constructor({ headerHeight = 28 /* ... */ }) {
        super(/* ... */);
        this._headerHeight = headerHeight;
    }

    _updateCollapsedState() {
        if (this._collapsed) {
            // Collapsed: hide content, set max height to header
            this.setMaxHeight(this._headerHeight);

            // Also hint that we'd like to be header-sized
            this.setDesiredSize({ height: this._headerHeight });

            if (this._contentContainer) {
                this._contentContainer.style.display = 'none';
            }
        } else {
            // Expanded: show content, remove constraints
            this.setMaxHeight(null);
            this.setDesiredSize({ height: null }); // Clear hint

            if (this._contentContainer) {
                this._contentContainer.style.display = '';
            }
        }
    }
}
```

**Why both `setMaxHeight()` and `setDesiredSize()`?**

- `setMaxHeight()` - Prevents container from allocating more space (hard constraint)
- `setDesiredSize()` - Asks container to shrink to header height (soft hint)

The combination ensures the collapsed view is exactly header height when possible.

---

## Real-World Example: GeneralSettingsView

GeneralSettingsView requests a comfortable height for its controls:

```ts
class GeneralSettingsView extends ViewBase {
    afterAttach() {
        super.afterAttach();

        // Measure actual rendered content height
        const contentHeight = this._measureContentHeight();

        // Add some padding for comfort
        const desiredHeight = contentHeight + 40;

        // Suggest this height to hosting container
        this.setDesiredSize({ height: desiredHeight });
    }

    _measureContentHeight() {
        if (!this.container) return 0;

        const root = this.container.querySelector('.view-general-settings');
        if (!root) return 0;

        // Use scrollHeight to get natural content height
        return root.scrollHeight;
    }
}
```

When placed in a SplitView, the container can use this hint to initially size the settings panel appropriately.

---

## Testing

### Unit Tests

**File:** `tests/views/view-base-desired-size.test.js`

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ViewBase } from '../src/micro_otter/nodes/html/js/views/view-base.js';

describe('ViewBase - Desired Size', () => {
    it('should initialize with no desired size', () => {
        const view = new ViewBase();
        const { width, height } = view.getDesiredSize();

        assert.equal(width, null);
        assert.equal(height, null);
    });

    it('should set desired width and height', () => {
        const view = new ViewBase();
        view.setDesiredSize({ width: 300, height: 200 });

        const { width, height } = view.getDesiredSize();
        assert.equal(width, 300);
        assert.equal(height, 200);
    });

    it('should set only desired height', () => {
        const view = new ViewBase();
        view.setDesiredSize({ height: 150 });

        const { width, height } = view.getDesiredSize();
        assert.equal(width, null);
        assert.equal(height, 150);
    });

    it('should clear desired dimensions', () => {
        const view = new ViewBase();
        view.setDesiredSize({ width: 300, height: 200 });
        view.setDesiredSize({ width: null, height: null });

        const { width, height } = view.getDesiredSize();
        assert.equal(width, null);
        assert.equal(height, null);
    });

    it('should emit desiredSize event when dimensions change', () => {
        const view = new ViewBase();
        let eventData = null;

        view.on('desiredSize', (data) => {
            eventData = data;
        });

        view.setDesiredSize({ width: 300, height: 200 });

        assert.notEqual(eventData, null);
        assert.equal(eventData.width, 300);
        assert.equal(eventData.height, 200);
    });

    it('should not emit event if dimensions unchanged', () => {
        const view = new ViewBase();
        view.setDesiredSize({ width: 300, height: 200 });

        let eventCount = 0;
        view.on('desiredSize', () => {
            eventCount++;
        });

        view.setDesiredSize({ width: 300, height: 200 }); // Same values

        assert.equal(eventCount, 0);
    });

    it('should treat zero and negative values as null', () => {
        const view = new ViewBase();
        view.setDesiredSize({ width: 0, height: -50 });

        const { width, height } = view.getDesiredSize();
        assert.equal(width, null);
        assert.equal(height, null);
    });

    it('should treat non-numeric values as null', () => {
        const view = new ViewBase();
        view.setDesiredSize({ width: 'large', height: undefined });

        const { width, height } = view.getDesiredSize();
        assert.equal(width, null);
        assert.equal(height, null);
    });
});
```

### Integration Tests with SplitView

**File:** `tests/views/split-view-desired-size.test.js`

```ts
describe('SplitView - Desired Size Integration', () => {
    it('should honor desired sizes during initial layout', () => {
        const view1 = new ViewBase();
        view1.setDesiredSize({ height: 100 });

        const view2 = new ViewBase();
        view2.setDesiredSize({ height: 200 });

        const splitView = new SplitView({
            orientation: 'vertical',
            views: [view1, view2],
        });

        // Container with 400px available
        const container = createContainer({ height: 400 });
        splitView.attachTo(container);

        // SplitView should allocate approximately:
        // view1: 100px (+ some flex for extra space)
        // view2: 200px (+ some flex for extra space)
        // Total: 300px requested, 100px extra to distribute

        const pane1Height = getPaneHeight(splitView, 0);
        const pane2Height = getPaneHeight(splitView, 1);

        // View 1 should get at least its desired 100px
        assert.ok(pane1Height >= 100);

        // View 2 should get at least its desired 200px
        assert.ok(pane2Height >= 200);

        // Total should equal container height
        assert.equal(pane1Height + pane2Height, 400);
    });

    it('should respect constraints over desired size', () => {
        const view = new ViewBase();
        view.setSizeConstraints({ minHeight: 50, maxHeight: 150 });
        view.setDesiredSize({ height: 200 }); // Exceeds max

        const splitView = new SplitView({
            orientation: 'vertical',
            views: [view],
        });

        const container = createContainer({ height: 400 });
        splitView.attachTo(container);

        const paneHeight = getPaneHeight(splitView, 0);

        // Should be clamped to maxHeight despite higher desired size
        assert.equal(paneHeight, 150);
    });
});
```

---

## Related Documentation

- **[view-system-architecture.md](view-system-architecture.md)** - ViewBase lifecycle and constraints
- **[settings-views-guide.md](settings-views-guide.md)** - Settings views using desired size
- **[collapsible-view.md](collapsible-view.md)** - CollapsibleView using desired size
- **Split View Architecture** (when available) - Container implementation details

---

## Future Enhancements

### Desired Size Presets

Add convenience methods for common patterns:

```ts
// Proposed API
view.setDesiredSizeToContent(); // Measure and set
view.setDesiredSizeToFit(); // Match content natural size
view.setDesiredSizeToCompact(); // Minimal comfortable size
```

### Aspect Ratio Hints

Allow views to request specific aspect ratios:

```ts
// Proposed API
view.setDesiredAspectRatio(16 / 9); // Request 16:9 ratio
view.setDesiredAspectRatio(null); // Clear ratio preference
```

### Priority Levels

Allow views to indicate how important their size preference is:

```ts
// Proposed API
view.setDesiredSize({
    height: 200,
    priority: 'high', // 'low' | 'normal' | 'high' | 'required'
});
```

Containers could use priority to resolve conflicts when multiple views request more space than available.
