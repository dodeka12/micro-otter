# Deployment Access Control

This document explains how to configure standard webservers to prevent direct browser access to application resources while allowing application module requests.

## Security Goal

- **Allow**: Index HTML files (`/`, `/index.html`) as entry points
- **Block**: Direct browser navigation to `/html/*` and `/device/*` paths
- **Allow**: Application module requests (fetch, import) to access all resources

## How It Works

Modern browsers send `Sec-Fetch-*` headers with every request:

- `Sec-Fetch-Mode: navigate` → User typed URL or clicked link (browser navigation)
- `Sec-Fetch-Mode: cors` → TypeScript module fetch() or import requests
- `Sec-Fetch-Dest: document` → Loading as HTML page
- `Sec-Fetch-Dest: script` → Loading as script/module
- `Sec-Fetch-Dest: style` → Loading as CSS
- `Sec-Fetch-Dest: empty` → Fetch API with no specific type

Direct browser navigation has: `Sec-Fetch-Mode: navigate` AND `Sec-Fetch-Dest: document`

## Apache Configuration

Add to `.htaccess` in the `nodes/` directory:

```apache
# Enable Apache modules if not already enabled:
# a2enmod headers
# a2enmod rewrite

# Deny direct browser navigation to protected resources
<IfModule mod_headers.c>
    <IfModule mod_rewrite.c>
        RewriteEngine On

        # Allow index files and favicon
        RewriteCond %{REQUEST_URI} ^/(index\.html|index-v2\.html|favicon\.ico)?$ [OR]
        RewriteCond %{REQUEST_URI} ^/$
        RewriteRule ^ - [L]

        # Block direct navigation to /html/* and /device/*
        # Check for navigate mode AND document destination
        RewriteCond %{REQUEST_URI} ^/(html|device)/ [NC]
        RewriteCond %{HTTP:Sec-Fetch-Mode} =navigate
        RewriteCond %{HTTP:Sec-Fetch-Dest} =document
        RewriteRule ^ - [F,L]
    </IfModule>
</IfModule>

# Add security headers
<IfModule mod_headers.c>
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
</IfModule>
```

## Nginx Configuration

Add to your server block:

```nginx
server {
    listen 80;
    server_name yourserver.com;
    root /path/to/micro-otter/src/micro_otter/nodes;
    index index.html;

    # Allow index files and root
    location = / {
        try_files /index.html =404;
    }

    location = /index.html {}
    location = /favicon.ico {}

    # Block direct navigation to /html/* and /runtime/*
    location ~ ^/(html|device)/ {
        # Check if this is direct browser navigation
        set $is_navigate 0;
        if ($http_sec_fetch_mode = "navigate") {
            set $is_navigate 1;
        }
        if ($http_sec_fetch_dest = "document") {
            set $is_navigate "${is_navigate}1";
        }

        # Block if both conditions are true (is_navigate = 11)
        if ($is_navigate = "11") {
            return 403 "Direct access to this resource is not allowed. Please access the application through the main page.";
        }

        # Allow application module requests
        try_files $uri =404;
    }

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

## Development Server

The Python development server (`mo serve`) includes this protection automatically. It checks:

1. `Sec-Fetch-Mode: navigate` AND `Sec-Fetch-Dest: document`
2. If true and path starts with `/html/` or `/device/`
3. Returns 403 Forbidden

## Testing

**Should be blocked (403 Forbidden):**

```bash
# Direct browser navigation - will be blocked
http://localhost:8000/html/js/app/main.ts
http://localhost:8000/device/runtime/manifest.json
```

**Should work:**

```bash
# Entry points - always allowed
http://localhost:8000/
http://localhost:8000/index.html

# TypeScript module fetch/import - allowed
fetch('http://localhost:8000/html/js/app/main.ts')
import('http://localhost:8000/html/js/app/main.ts')
```

## Browser Compatibility

`Sec-Fetch-*` headers are supported in:

- Chrome/Edge 76+ (2019)
- Firefox 90+ (2021)
- Safari 15.4+ (2022)

**Fallback for older browsers:** If headers are not present, the server allows access (fail-open). For strict security, you could fail-closed by blocking if headers are missing, but this breaks older browsers.

## Limitations

1. **Not foolproof**: Technically savvy users can bypass using browser dev tools or curl
2. **Purpose**: Prevents casual users from bookmarking/sharing direct asset URLs
3. **Better approach**: For true security, implement authentication/authorization at the server level

This is a UX improvement, not a security mechanism. It helps users avoid confusion by ensuring they always enter through the proper entry point.
