# I18n System Architecture

## Overview

The Micro Otter i18n (internationalization) system provides translation management for the web application. Built on **I18nService** (extends EventTarget), it offers lazy-loading translations, variable interpolation, fallback handling, and seamless integration with the view system.

## Core Components

### I18nService

**Location**: `src/micro_otter/nodes/html/js/i18n/i18n-service.ts`

**Key Features**:
- EventTarget-based for language change notifications
- Lazy-loads translations from JSON files
- Per-locale translation caching
- Fallback to default locale for missing keys
- Nested key support with dot notation
- Variable interpolation using `{{variable}}` syntax

### Translation Files

**Location**: `src/micro_otter/nodes/html/locales/`

**Structure**:
- **locales.json**: Manifest listing available locales
- **[locale].json**: Translation dictionaries (e.g., en.json, de.json)

## Service Initialization

```ts
import { I18nService } from '../i18n/i18n-service.ts';

const i18n = new I18nService({
    manifestPath: '/html/locales/locales.json',  // Locale metadata
    defaultLocale: 'en',                          // Fallback language
    initialLocale: null,                          // Auto-detect or from config
    logger: customLogger                          // Optional logging
});

// Load manifest and initial locale
await i18n.load();

// Or manually set locale after creation
await i18n.setLocale('de');
```

## Translation File Format

### Manifest (locales.json)

```json
{
  "defaultLocale": "en",
  "locales": [
    {
      "code": "en",
      "label": "English",
      "file": "en.json",
      "icon": "icon-en.svg"
    },
    {
      "code": "de",
      "label": "Deutsch", 
      "file": "de.json",
      "icon": "icon-de.svg"
    }
  ]
}
```

### Locale Dictionary (en.json, de.json)

```json
{
  "dialog": {
    "confirm": "Confirm",
    "cancel": "Cancel",
    "delete": "Delete",
    "deleteMessage": "Are you sure you want to delete {{name}}?"
  },
  "palette": {
    "title": "Node Palette",
    "search": "Search nodes...",
    "ioSummary": "{{inputs}} in / {{outputs}} out",
    "infoIconLabel": "About {{name}}",
    "nodePackage": {
      "addonBadge": "Add-on",
      "addonTooltip": "Installed from an add-on package"
    }
  },
  "nodeGraph": {
    "emptyGraph": "Drag nodes from the node palette to begin developing your graph",
    "contextMenu": {
      "delete": "Delete",
      "duplicate": "Duplicate",
      "copy": "Copy",
      "paste": "Paste"
    }
  },
  "error": {
    "title": "Error",
    "loadFailed": "Failed to load workspace: {{message}}"
  }
}
```

## Key Format Conventions

### Hierarchical Namespacing

Use dot notation for nested structure:

- **dialog.confirm**: Dialog-related strings
- **menu.upload**: Menu items
- **properties.nodeType.label**: Node property labels
- **webserial.wifiDialog.title**: Feature-specific dialogs
- **loading.status**: Loading indicators
- **status.error**: Status messages

### Variable Placeholders

Use `{{variableName}}` for dynamic content:

- `{{name}}`: Entity name
- `{{count}}`: Count values
- `{{inputs}}, {{outputs}}`: Node I/O counts
- `{{message}}`: Error messages
- `{{filename}}`: File names

## Usage in Views

### ViewBase Integration

All views extending **ViewBase** have built-in i18n support:

```ts
import { ViewBase } from './view-base.js';

class MyView extends ViewBase {
    constructor({ i18nService, ...rest }) {
        super({ i18nService, ...rest });
    }
    
    render(container) {
        const heading = document.createElement('h2');
        heading.textContent = this.t('palette.title');
        
        const summary = document.createElement('p');
        summary.textContent = this.t('palette.ioSummary', {
            inputs: 3,
            outputs: 2
        });
        
        container.append(heading, summary);
    }
    
    afterAttach() {
        // Subscribe to language changes (auto cleanup on detach)
        this._subscribeToLanguageChanges((event) => {
            this.render(this.container); // Re-render with new locale
        });
    }
}
```

### Translation Method: t(key, params)

```ts
// Simple translation
const label = this.t('dialog.confirm');
// Returns: "Confirm" (en) or "Bestätigen" (de)

// With variable interpolation
const message = this.t('palette.ioSummary', { 
    inputs: 5, 
    outputs: 3 
});
// Returns: "5 in / 3 out" (en) or "5 Ein / 3 Aus" (de)

// Nested keys
const title = this.t('webserial.wifiDialog.title');
// Returns: "Configure Board WiFi"

// Multiple variables
const error = this.t('error.loadFailed', { 
    message: 'Connection timeout'
});
// Returns: "Failed to load workspace: Connection timeout"
```

### Subscribing to Language Changes

ViewBase provides **_subscribeToLanguageChanges()** for automatic re-rendering:

```ts
afterAttach() {
    this._subscribeToLanguageChanges((event) => {
        console.log(`Language changed from ${event.detail.previousLocale} to ${event.detail.locale}`);
        this._updateLabels();
    });
}

// Cleanup is automatic in ViewBase.beforeDetach()
```

## Event Flow

### Language Change Event

When locale changes, I18nService dispatches **languagechange** event:

```ts
// I18nService dispatches:
this.dispatchEvent(new CustomEvent('languagechange', {
    detail: { 
        locale: 'de',           // New locale
        previousLocale: 'en'    // Old locale
    }
}));

// Views automatically receive via _subscribeToLanguageChanges()
// Or subscribe manually:
i18nService.addEventListener('languagechange', (event) => {
    console.log('Switched to:', event.detail.locale);
});
```

### ViewManager Integration

ViewManager creates and distributes I18nService to all views:

```ts
import { ViewManager } from './view-manager.js';

const manager = new ViewManager({
    mount: rootElement,
    i18nService: customI18nService // Optional; auto-created if omitted
});

// Access i18n service
console.log('Current locale:', manager.i18nService.currentLocale);

// Change language globally
await manager.i18nService.setLocale('de');

// Subscribe to changes at manager level
manager.i18nEvents.addEventListener('languagechange', (event) => {
    console.log('App language changed:', event.detail.locale);
});
```

### ViewFactory Context Injection

ViewFactory automatically injects i18nService when creating views:

```ts
// ViewFactory passes i18nService to all views
const context = {
    i18nService: this._i18nService,
    logger: this._logger
};

const view = new GraphPanelView(context);
// View now has access to this._i18nService
```

## Dynamic Content Handling

### Node Type Names

Construct translation keys dynamically based on node types:

```ts
// For a node type "analogInput"
const nodeLabel = this.t(`nodes.${nodeType}.label`);
// Looks for: nodes.analogInput.label

const nodeDescription = this.t(`nodes.${nodeType}.description`);
// Looks for: nodes.analogInput.description
```

**Translation file**:
```json
{
  "nodes": {
    "analogInput": {
      "label": "Analog Input",
      "description": "Read analog voltage from a pin"
    },
    "digitalOutput": {
      "label": "Digital Output",
      "description": "Set pin to HIGH or LOW"
    }
  }
}
```

### Error Messages with Context

```ts
try {
    await deployCode();
} catch (error) {
    const msg = this.t('status.error', { 
        message: error.message,
        code: error.code 
    });
    
    // Show error via ViewManager modal
    await this._viewManager.showError({
        title: this.t('error.title'),
        message: msg
    });
}
```

### Control Labels and Values

```ts
// For a control in a node
const controlLabel = this.t(`controls.${controlType}.label`);

// For dropdown options
const options = optionKeys.map(key => ({
    value: key,
    label: this.t(`controls.${controlType}.options.${key}`)
}));
```

## Fallback Behavior

### Three-Level Fallback Chain

1. **Current locale**: Check active language
2. **Default locale**: Fall back to `en` if missing
3. **Return key**: If still missing, return the key itself as fallback

```ts
// Current locale: de, Default locale: en

this.t('dialog.newFeature')
// 1. Check de.json → not found
// 2. Check en.json → not found  
// 3. Return "dialog.newFeature" (key as fallback)

this.t('dialog.confirm')
// 1. Check de.json → "Bestätigen" ✓
// Returns: "Bestätigen"
```

### Missing Key Logging

I18nService logs warnings for missing translations:

```ts
// Missing in current locale (found in default):
"[i18n-service] Translation key 'dialog.advanced' not found in de, using default"

// Completely missing:
"[i18n-service] Translation key not found: 'feature.experimental', returning key"
```

## Best Practices

### Key Organization

Group keys by feature or component:

```json
{
  "nodeGraph": {
    "emptyGraph": "...",
    "contextMenu": { ... },
    "viewport": { ... }
  },
  "nodePalette": {
    "search": "...",
    "organizeModes": { ... }
  }
}
```

### Variable Naming

Use clear, descriptive variable names:

- **Good**: `{{nodeCount}}`, `{{filename}}`, `{{maxValue}}`
- **Avoid**: `{{x}}`, `{{data}}`, `{{thing}}`

### Translation Keys

Use descriptive keys that hint at context:

- **Good**: `nodeGraph.contextMenu.delete`, `dialog.confirmDelete`
- **Avoid**: `delete`, `confirm`, `msg1`

### View Re-rendering

Only re-render necessary parts on language change:

```ts
afterAttach() {
    this._subscribeToLanguageChanges(() => {
        this._updateLabels(); // Update only text content
        // Don't rebuild entire DOM unnecessarily
    });
}

_updateLabels() {
    this._titleElement.textContent = this.t('myView.title');
    this._descElement.textContent = this.t('myView.description');
}
```

### Error Messages

Always include context in error messages:

```json
{
  "error": {
    "saveFailed": "Failed to save {{itemType}}: {{reason}}",
    "loadFailed": "Failed to load {{itemType}}: {{reason}}",
    "connectionLost": "Connection to {{device}} lost"
  }
}
```

## Adding New Translations

### 1. Add Keys to Locale Files

Edit all locale files (en.json, de.json, etc.):

**en.json**:
```json
{
  "myFeature": {
    "title": "My Feature",
    "description": "Configure {{count}} items",
    "buttonLabel": "Apply Changes"
  }
}
```

**de.json**:
```json
{
  "myFeature": {
    "title": "Meine Funktion",
    "description": "{{count}} Elemente konfigurieren",
    "buttonLabel": "Änderungen übernehmen"
  }
}
```

### 2. Use in View

```ts
class MyFeatureView extends ViewBase {
    render(container) {
        const title = document.createElement('h2');
        title.textContent = this.t('myFeature.title');
        
        const desc = document.createElement('p');
        desc.textContent = this.t('myFeature.description', { count: 5 });
        
        const button = document.createElement('button');
        button.textContent = this.t('myFeature.buttonLabel');
        button.onclick = () => this._applyChanges();
        
        container.append(title, desc, button);
    }
}
```

### 3. Test with Multiple Locales

```ts
// Switch locale programmatically
await viewManager.i18nService.setLocale('de');
// Verify all strings update correctly

await viewManager.i18nService.setLocale('en');
// Verify fallback to English works
```

## Node UI Translation Strategy

### Node Type Definitions

Store node metadata in translation files:

```json
{
  "nodes": {
    "analogInput": {
      "label": "Analog Input",
      "description": "Read analog voltage from a pin",
      "category": "Input/Output"
    },
    "timer": {
      "label": "Timer",
      "description": "Execute code at regular intervals",
      "category": "Timing"
    }
  }
}
```

### Control Labels

```json
{
  "controls": {
    "pin": {
      "label": "Pin Number",
      "help": "Select the GPIO pin to use"
    },
    "interval": {
      "label": "Interval (ms)",
      "help": "Time between executions in milliseconds"
    }
  }
}
```

### Context Menus

```json
{
  "nodeGraph": {
    "contextMenu": {
      "node": {
        "delete": "Delete Node",
        "duplicate": "Duplicate Node",
        "copy": "Copy",
        "paste": "Paste"
      },
      "canvas": {
        "addNode": "Add Node",
        "selectAll": "Select All",
        "zoomToFit": "Zoom to Fit"
      }
    }
  }
}
```

### Status Messages

```json
{
  "status": {
    "saving": "Saving workspace...",
    "deploying": "Deploying to device {{deviceName}}...",
    "deploySuccess": "Successfully deployed to {{deviceName}}",
    "deployFailed": "Deployment failed: {{error}}"
  }
}
```

## Integration Example: NodePaletteView

```ts
class NodePaletteView extends ViewBase {
    render(container) {
        // Title
        const title = document.createElement('h2');
        title.textContent = this.t('nodePalette.title');
        
        // Search input
        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = this.t('nodePalette.search');
        
        // Organize mode buttons
        const modeButtons = this._createModeButtons();
        
        // Node items
        const nodeList = this._createNodeList();
        
        container.append(title, search, modeButtons, nodeList);
    }
    
    _createModeButtons() {
        const modes = ['alphabetical', 'byPackage', 'byCategory'];
        const container = document.createElement('div');
        
        modes.forEach(mode => {
            const button = document.createElement('button');
            button.textContent = this.t(`nodePalette.organizeMode.${mode}`);
            button.onclick = () => this._setOrganizeMode(mode);
            container.appendChild(button);
        });
        
        return container;
    }
    
    _createNodeList() {
        const list = document.createElement('div');
        
        this._nodeTypes.forEach(nodeType => {
            const item = document.createElement('div');
            
            // Node label (translated)
            const label = document.createElement('span');
            label.textContent = this.t(`nodes.${nodeType.id}.label`);
            
            // I/O summary (translated with variables)
            const summary = document.createElement('span');
            summary.textContent = this.t('nodePalette.ioSummary', {
                inputs: nodeType.inputs.length,
                outputs: nodeType.outputs.length
            });
            
            item.append(label, summary);
            list.appendChild(item);
        });
        
        return list;
    }
    
    afterAttach() {
        // Update when language changes
        this._subscribeToLanguageChanges(() => {
            this.render(this.container);
        });
    }
}
```

## API Reference

### I18nService

#### Properties

- **currentLocale**: Active locale code (e.g., 'en', 'de')
- **defaultLocale**: Fallback locale code
- **availableLocales**: Array of supported locales from manifest

#### Methods

- **load()**: Load manifest and initial locale (returns Promise)
- **setLocale(code)**: Switch to specified locale (returns Promise)
- **t(key, params)**: Translate key with optional variables (returns string)
- **addEventListener(event, handler)**: Subscribe to 'languagechange' events
- **removeEventListener(event, handler)**: Unsubscribe from events

### ViewBase i18n Methods

- **t(key, params)**: Translate key (delegates to i18nService)
- **_subscribeToLanguageChanges(handler)**: Subscribe to locale changes (auto cleanup)

## Related Documentation

- [View System Architecture](view-system-architecture.md) - View lifecycle and integration
- [Data Backbone Architecture](data-backbone-architecture.md) - Data model and events
- [Node UI Implementation Plan](../../../ldev/todos/v2/node-ui-plan/00-overview.md) - UI roadmap
