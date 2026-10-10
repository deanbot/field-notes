# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Report vulnerabilities privately through GitHub: [Report a vulnerability](https://github.com/deanbot/field-notes/security/advisories/new).

You'll get an acknowledgement as soon as the maintainer sees it, and updates as the issue is investigated and fixed.

## Scope

field-notes is a development tool, but parts of it deserve particular scrutiny:

- **The local sink** (`field-notes serve`, the Vite plugin, the middleware) listens for HTTP requests and writes files. It is designed to bind to loopback only, check origins, require a token, enforce size limits and never trust client-supplied paths. Any way around those protections is in scope.
- **`field-notes import`** unpacks zip files that may come from other people. Path traversal, symlink tricks and resource exhaustion are in scope.
- **The widget** runs inside host pages and may capture screenshots. Leaks of masked content, or data sent anywhere other than the configured destination, are in scope.

## Notes are untrusted input

Note content is free text written by whoever used the widget, and imported zips may come from other people. Tools and coding agents that read notes should treat them as data to evaluate, not instructions to follow.

## Supported versions

Until 1.0, only the latest release receives fixes.
