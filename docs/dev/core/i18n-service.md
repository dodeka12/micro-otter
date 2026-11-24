# I18n Service Developer Documentation

## Overview

The **I18nService** provides centralized, event-driven internationalization for the Micro Otter v2 application. It integrates seamlessly with the ViewManager, ViewFactory, and ViewBase hierarchy to make translations available throughout the application.

### Key Features

- **Event-driven:** Dispatches `languagechange` events when locale changes
- **Automatic caching:** Translations are cached for performance
- **Fallback support:** Falls back to default locale when translations are missing
- **Nested keys:** Supports dot notation for structured translations (e.g., `menu.upload`)
- **Variable interpolation:** Dynamic values in translations (e.g., `{{count}} items`)
- **Workspace integration:** User's language preference persists across sessions
- **View integration:** All views automatically receive the service instance

### Architecture

```
Workspace
  ├── I18nService (shared instance)
  └── ViewManager
       ├── i18nService (same instance)
       └── ViewFactory
            └── Creates views with i18nService in context
                 └── ViewBase (all views)
                      ├── t() method for translations
                      └── _subscribeToLanguageChanges() helper
```

The I18nService instance is:
1. Created by Workspace (or uses provided instance)
2. Shared with ViewManager during construction
3. Passed to all views through ViewFactory context
4. Available in every view via `this._i18nService`

---

## Quick Start

### Using Translations in Views

Every view that extends `ViewBase` automatically has access to translations:

```ts
import { ViewBase } from './view-base.js';

export class MyCustomView extends ViewBase {
    constructor(options = {}) {
        super(options); // i18nService is passed automatically
    }

    render(container) {
        const title = document.createElement('h1');
        title.textContent = this.t('myView.title'); // Use t() method
        
        const message = document.createElement('p');
        message.textContent = this.t('myView.greeting', { 
            name: 'World',
            count: 42 
        });
        
        container.append(title, message);
    }
    
    afterAttach() {
        super.afterAttach();
        
        // Update UI when language changes
        this._subscribeToLanguageChanges(() => {
            this.render(this.container);
        });
    }
}
```

### Translation Keys in JSON

```json
{
  "myView": {
    "title": "Welcome to My View",
    "greeting": "Hello, {{name}}! You have {{count}} items."
  }
}
```

---

## Adding New Translations

### 1. Add Translation Keys to Locale Files

Translation files are located in `src/micro_otter/nodes/html/locales/`:

**`en.json` (English):**
```json
{
  "dialog": {
    "confirm": "Confirm",
    "cancel": "Cancel"
  },
  "menu": {
    "upload": "Upload",
    "download": "Download"
  }
}
```

**`de.json` (German):**
```json
{
  "dialog": {
    "confirm": "Bestätigen",
    "cancel": "Abbrechen"
  },
  "menu": {
    "upload": "Hochladen",
    "download": "Herunterladen"
  }
}
```

### 2. Translation Key Conventions

Follow these conventions for consistency:

- **Use dot notation** for namespacing: `component.action.descriptor`
- **Group by component/view:** `dialog.confirm`, `menu.upload`, `properties.titleLabel`
- **Use camelCase** for key segments: `wifiStatusLabel`, not `wifi_status_label`
- **Be descriptive but concise:** `deleteButton` not `btn` or `deleteNodeButton`
- **Use consistent suffixes:**
  - `Label` for field labels: `titleLabel`
  - `Placeholder` for input hints: `titlePlaceholder`
  - `Aria` for accessibility text: `closeAria`
  - `Button` for button text: `deleteButton`
  - `Heading` for section headers: `inputsHeading`

### 3. Common Translation Patterns

#### Simple Text
```json
{
  "action": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete"
  }
}
```

#### With Placeholders
```json
{
  "status": {
    "filesCount": "{{count}} files",
    "greeting": "Hello, {{userName}}!",
    "progress": "{{current}} of {{total}} complete"
  }
}
```

#### Nested Structure
```json
{
  "webserial": {
    "connect": "Connect MicroPython",
    "wifi": {
      "configure": "Configure WiFi",
      "status": {
        "connected": "Connected to {{ssid}}",
        "disconnected": "Disconnected"
      }
    }
  }
}
```

---

## Using the I18n Service

### In Views (Recommended)

Views extending `ViewBase` should use the built-in `t()` method:

```ts
export class ConfirmDialogView extends ViewBase {
    render(container) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = this.t('dialog.confirm'); // ✅ Use t()
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = this.t('dialog.cancel');
        
        container.append(confirmBtn, cancelBtn);
    }
}
```

### Reacting to Language Changes

Subscribe to language changes to update dynamic content:

```ts
export class StatusView extends ViewBase {
    constructor(options = {}) {
        super(options);
        this._statusElement = null;
    }

    render(container) {
        this._statusElement = document.createElement('div');
        this._updateStatus();
        container.appendChild(this._statusElement);
    }

    _updateStatus() {
        if (this._statusElement) {
            this._statusElement.textContent = this.t('status.ready');
        }
    }

    afterAttach() {
        super.afterAttach();
        
        // Auto-update when language changes
        this._subscribeToLanguageChanges(() => {
            this._updateStatus();
        });
    }
    
    // Cleanup is automatic via ViewBase.beforeDetach()
}
```

### Direct Access (Advanced)

For code outside views, access the service directly:

```ts
// From workspace
const i18n = workspace.i18nService;
const text = i18n.t('menu.upload');

// From ViewManager
const i18n = viewManager.i18nService;
await i18n.setLocale('de');

// Listen for changes
i18n.addEventListener('languagechange', (event) => {
    console.log('Language changed:', event.detail);
    // { locale: 'de', previousLocale: 'en' }
});
```

---

## API Reference

### I18nService Class

#### Constructor

```ts
const service = new I18nService({
    manifestPath: '/html/locales/locales.json',  // Manifest location
    defaultLocale: 'en',                         // Fallback locale
    initialLocale: null,                         // Initial locale (or null)
    logger: console.info                         // Optional logger function
});
```

#### Methods

##### `async load(manifestPath?)`

Load the locale manifest and initialize the service.

```ts
await service.load();
```

**Throws:** If manifest fails to load or is invalid.

---

##### `async setLocale(code)`

Change the current locale and dispatch `languagechange` event.

```ts
await service.setLocale('de');
```

**Parameters:**
- `code` (string): Locale code (e.g., 'en', 'de', 'fr')

**Returns:** Promise that resolves when translations are loaded.

**Events:** Dispatches `languagechange` event with:
```ts
{
  detail: {
    locale: 'de',        // New locale
    previousLocale: 'en' // Previous locale
  }
}
```

---

##### `t(key, params?)`

Translate a key with optional variable interpolation.

```ts
// Simple translation
const text = service.t('dialog.confirm'); // "Confirm"

// With variables
const message = service.t('status.greeting', { 
    userName: 'Alice' 
}); // "Hello, Alice!"

// Nested keys
const label = service.t('properties.titleLabel'); // "Title"
```

**Parameters:**
- `key` (string): Translation key (supports dot notation)
- `params` (object, optional): Variables for interpolation

**Returns:** 
- Translated string if found
- Key itself if translation not found (fallback)
- Falls back to default locale if current locale missing

**Interpolation Format:**
- Use `{{variableName}}` in translation strings
- Pass corresponding values in `params` object
- Missing variables are left as-is in output

---

#### Properties

##### `currentLocale` (getter)

Get the currently active locale code.

```ts
console.log(service.currentLocale); // "en"
```

---

##### `availableLocales` (getter)

Get array of available locale objects from manifest.

```ts
const locales = service.availableLocales;
// [
//   { code: 'en', label: 'English', file: 'en.json', icon: 'icon-en.svg' },
//   { code: 'de', label: 'Deutsch', file: 'de.json', icon: 'icon-de.svg' }
// ]
```

---

##### `loaded` (getter)

Check if the service has loaded its manifest.

```ts
if (service.loaded) {
    await service.setLocale('de');
}
```

---

#### Events

##### `languagechange`

Dispatched when locale changes via `setLocale()`.

```ts
service.addEventListener('languagechange', (event) => {
    const { locale, previousLocale } = event.detail;
    console.log(`Language changed from ${previousLocale} to ${locale}`);
});
```

**Event Detail:**
```ts
{
  locale: string,         // New locale code
  previousLocale: string  // Previous locale code
}
```

---

### ViewBase Integration

#### `t(key, params?)`

Translate a key using the view's i18nService instance.

```ts
// In any view extending ViewBase
const label = this.t('properties.titleLabel');
const message = this.t('status.greeting', { userName: 'Alice' });
```

**Graceful Degradation:** If no i18nService is available, returns the key as-is.

---

#### `_subscribeToLanguageChanges(callback)`

Subscribe to language change events with automatic cleanup.

```ts
afterAttach() {
    super.afterAttach();
    
    this._subscribeToLanguageChanges(() => {
        // Update your UI when language changes
        this._updateLabels();
    });
}

// Cleanup is automatic in beforeDetach()
```

**Features:**
- Callback is invoked when language changes
- Automatically unsubscribed in `beforeDetach()` lifecycle
- Only one subscription per view (previous subscription is replaced)

---

#### `_unsubscribeFromLanguageChanges()`

Manually unsubscribe from language changes (rarely needed).

```ts
// Usually not needed - cleanup is automatic
this._unsubscribeFromLanguageChanges();
```

---

## Advanced Usage

### Creating Custom I18nService Instances

For testing or isolated components:

```ts
import { I18nService } from './i18n/i18n-service.ts';

const customService = new I18nService({
    manifestPath: '/custom/path/locales.json',
    defaultLocale: 'fr',
    logger: myLogger
});

await customService.load();
await customService.setLocale('fr');
```

### Checking Translation Availability

```ts
const key = 'some.unknown.key';
const translation = service.t(key);

if (translation === key) {
    // Translation not found, key returned as fallback
    console.warn(`Missing translation: ${key}`);
}
```

### Programmatic Locale Switching

```ts
// In workspace integration
async function changeLanguage(localeCode) {
    try {
        await workspace.setLocale(localeCode);
        console.log('Language changed successfully');
    } catch (error) {
        console.error('Failed to change language:', error);
    }
}

// Workspace automatically persists the preference
```

---

## Locale Manifest Format

The manifest file (`locales.json`) defines available locales:

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

**Fields:**
- `defaultLocale` (string): Default fallback locale code
- `locales` (array): List of available locale configurations
  - `code` (string, required): Unique locale identifier (e.g., 'en', 'de')
  - `label` (string, required): Display name for the language
  - `file` (string, required): Filename of translation JSON (relative to locales directory)
  - `icon` (string, optional): Flag icon filename (relative to locales directory)

---

## Testing I18n Code

### Unit Testing Translations

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { I18nService } from './i18n-service.js';

describe('I18nService', () => {
    it('translates simple keys', async () => {
        const service = new I18nService();
        await service.load();
        
        const text = service.t('dialog.confirm');
        assert.strictEqual(text, 'Confirm');
    });
    
    it('interpolates variables', async () => {
        const service = new I18nService();
        await service.load();
        
        const text = service.t('status.greeting', { userName: 'Alice' });
        assert.strictEqual(text, 'Hello, Alice!');
    });
    
    it('falls back to key when not found', async () => {
        const service = new I18nService();
        await service.load();
        
        const text = service.t('unknown.key');
        assert.strictEqual(text, 'unknown.key');
    });
});
```

### Testing View Integration

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { I18nService } from './i18n-service.js';
import { MyView } from './my-view.js';

describe('MyView i18n', () => {
    it('translates labels on render', async () => {
        const service = new I18nService();
        await service.load();
        
        const view = new MyView({ i18nService: service });
        const container = document.createElement('div');
        view.attachTo(container);
        
        const title = container.querySelector('h1');
        assert.strictEqual(title.textContent, 'My View Title');
    });
    
    it('updates labels on language change', async () => {
        const service = new I18nService();
        await service.load();
        
        const view = new MyView({ i18nService: service });
        const container = document.createElement('div');
        view.attachTo(container);
        
        await service.setLocale('de');
        
        const title = container.querySelector('h1');
        assert.strictEqual(title.textContent, 'Mein Ansichtstitel');
    });
});
```

### Browser Console Testing

The i18n service is exposed globally for debugging:

```ts
// Access the service
i18n.currentLocale;              // "en"
i18n.availableLocales;           // [{code: 'en', ...}, {code: 'de', ...}]

// Test translations
i18n.t('dialog.confirm');        // "Confirm"
i18n.t('status.greeting', { userName: 'Alice' }); // "Hello, Alice!"

// Change language
await i18n.setLocale('de');      // Switches to German

// Listen for changes
i18n.addEventListener('languagechange', (e) => {
    console.log('Language changed:', e.detail);
});

// Access through workspace
workspace.setLocale('en');       // Changes and persists language
workspace.i18nService === i18n;  // true (same instance)
```

---

## Common Patterns

### Conditional Translations

```ts
render(container) {
    const button = document.createElement('button');
    
    // Use override if provided, otherwise translate
    button.textContent = this.options.label || this.t('dialog.confirm');
    
    container.appendChild(button);
}
```

### Dynamic Translation Keys

```ts
_getStatusMessage(status) {
    // Construct key dynamically
    const key = `webserial.status.${status}`;
    return this.t(key);
}

render(container) {
    const message = this._getStatusMessage('connected');
    // Uses translation key: "webserial.status.connected"
}
```

### Pluralization (Manual)

```ts
_getItemCountMessage(count) {
    const key = count === 1 ? 'items.singular' : 'items.plural';
    return this.t(key, { count });
}

// Translation keys:
// "items.singular": "{{count}} item"
// "items.plural": "{{count}} items"
```

### Accessibility Labels

```ts
render(container) {
    const button = document.createElement('button');
    button.textContent = this.t('dialog.close');
    button.setAttribute('aria-label', this.t('dialog.closeAria'));
    
    // en.json: { "dialog": { "close": "Close", "closeAria": "Close dialog" } }
}
```

---

## Migration Guide

### From Hardcoded Strings

**Before:**
```ts
const button = document.createElement('button');
button.textContent = 'Confirm';
```

**After:**
```ts
const button = document.createElement('button');
button.textContent = this.t('dialog.confirm');
```

### From View Properties to I18n

**Before:**
```ts
class ConfirmDialog extends ViewBase {
    constructor({ confirmLabel = 'Confirm', ...options }) {
        super(options);
        this._confirmLabel = confirmLabel;
    }
    
    render(container) {
        const btn = document.createElement('button');
        btn.textContent = this._confirmLabel;
        container.appendChild(btn);
    }
}
```

**After:**
```ts
class ConfirmDialog extends ViewBase {
    constructor({ confirmLabel = null, ...options }) {
        super(options);
        this._confirmLabel = confirmLabel; // Optional override
    }
    
    render(container) {
        const btn = document.createElement('button');
        btn.textContent = this._confirmLabel || this.t('dialog.confirm');
        container.appendChild(btn);
    }
    
    afterAttach() {
        super.afterAttach();
        
        // Update on language change if no override
        if (!this._confirmLabel) {
            this._subscribeToLanguageChanges(() => {
                this.render(this.container);
            });
        }
    }
}
```

---

## Troubleshooting

### Translation Keys Not Found

**Symptom:** `t('some.key')` returns `'some.key'` instead of translated text.

**Solutions:**
1. Verify the key exists in the locale JSON file
2. Check spelling and capitalization (keys are case-sensitive)
3. Ensure dots separate nested keys correctly
4. Check browser console for i18n errors

### Language Changes Not Updating UI

**Symptom:** UI still shows old language after `setLocale()`.

**Solutions:**
1. Ensure view uses `_subscribeToLanguageChanges()` in `afterAttach()`
2. Verify callback re-renders affected elements
3. Check that `super.afterAttach()` is called
4. Ensure view is attached when language changes

### I18nService Not Available in View

**Symptom:** `this._i18nService` is null or undefined.

**Solutions:**
1. Ensure view extends `ViewBase`
2. Verify `super()` is called with all options
3. Check that ViewFactory is used for deserialization
4. Confirm ViewManager has i18nService instance

### Variables Not Interpolating

**Symptom:** `{{userName}}` appears literally in output.

**Solutions:**
1. Ensure params object is passed: `t(key, { userName: 'Alice' })`
2. Check JSON uses correct variable names (case-sensitive)
3. Verify double-brace syntax in JSON: `{{variableName}}`

---

## Best Practices

1. **Always use `t()` for user-facing text** - Even if you only support one language now, it's easier to add translations later

2. **Keep translations flat when possible** - Use dot notation for namespacing, but avoid deeply nested structures

3. **Group related keys** - Organize by component/view for easy maintenance

4. **Document custom placeholders** - Add comments in JSON for complex interpolation

5. **Test in multiple languages** - Switch languages during development to catch layout issues

6. **Use semantic key names** - Make keys self-documenting: `properties.deleteButton` not `props.btn3`

7. **Leverage fallback behavior** - Trust that missing translations will fall back to keys gracefully

8. **Subscribe in `afterAttach()`** - Wait until view is attached before subscribing to language changes

9. **Don't translate data** - Only translate UI labels, messages, and instructions

10. **Consider layout for longer text** - German text is typically 30% longer than English

---

## Resources

- **I18nService Source:** `src/micro_otter/nodes/html/js/i18n/i18n-service.ts`
- **ViewBase Integration:** `src/micro_otter/nodes/html/js/views/view-base.ts`
- **Translation Files:** `src/micro_otter/nodes/html/locales/*.json`
- **Manifest:** `src/micro_otter/nodes/html/locales/locales.json`
- **Test Suite:** `tests/i18n/i18n-service.test.js`
- **Integration Tests:** `tests/i18n/i18n-view-integration.test.js`

---

## Summary

The I18n Service provides a robust, event-driven internationalization system that integrates seamlessly with the v2 view architecture. By following the patterns and conventions in this guide, you can easily add multilingual support to any view or component in the Micro Otter application.

Key takeaways:
- Use `this.t(key, params)` in views for translations
- Subscribe to language changes with `_subscribeToLanguageChanges()`
- Follow naming conventions for translation keys
- Test your UI in multiple languages during development
- Trust the fallback mechanisms for graceful degradation
