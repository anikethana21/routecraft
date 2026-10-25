# Privacy Policy - RouteCraft

**Last updated: 23 October 2026**

RouteCraft is a local-first OpenAPI documentation viewer and HTTP request console. It does not require an account and does not include analytics, advertising, telemetry or a remote backend.

## What RouteCraft stores

The app stores the following for the current browser profile:

- Your theme preference.
- Recently opened specification URLs and their titles.
- The last specification URL.
- Your request-console draft (method, URL, headers, parameters, body and body type).
- API credentials you explicitly enter (Bearer tokens, Basic credentials, API keys, OAuth access tokens).
- Request history (method, URL, status, timing, response size, request headers, request body and a short response preview).
- Per-spec base URL overrides.
- One-time headers used to open a protected specification from the toolbar popup or address-bar keyword. These are kept in `chrome.storage.session` for at most two minutes and are not written to disk.

The Chrome extension uses browser local storage. The Tampermonkey userscript uses Tampermonkey storage so the same history and settings are available across sites. This data never leaves your device except when it is included in a request you explicitly send to an API. For example, an Authorization header is sent to the API that you chose to call.

## Network requests

RouteCraft sends requests only to URLs that you enter or that are declared as servers in a specification you load.

- The web build uses `fetch()` from the page.
- The Chrome extension sends requests through its Manifest V3 service worker so that APIs without CORS headers can still be used.
- The Tampermonkey userscript sends requests through `GM_xmlhttpRequest` for the same zero-CORS behaviour.
- The MCP server serves the app from a loopback-only address and proxies requests through Node's `fetch` on your machine.
- OAuth token exchange uses the same request path as the active browser surface.

The developer of RouteCraft does not receive, log or sell these requests or their contents. There is no proxy server controlled by the developer.

## What RouteCraft does not collect

- No names, email addresses, accounts or passwords for RouteCraft itself.
- No analytics, crash reporting or usage statistics.
- No advertising identifiers.
- No browsing history beyond the current tab URL that the extension reads when you open its popup or ask it to open that tab's API.
- No data sold or shared with third parties.

## Chrome extension permissions

- **tabs:** opens or focuses the RouteCraft tab and lets the popup use the current page's origin to find a specification.
- **storage:** stores the one-time headers for a protected spec in session storage for up to two minutes. General settings, credentials and history remain in browser local storage.
- **sidePanel:** provides the optional side-panel view.
- **Host permissions for all URLs (`<all_urls>`):** required because the user chooses arbitrary local or remote API and specification URLs.

The extension injects no content scripts, loads no remote code and makes no requests except those needed to load a specification or execute a request chosen by the user.

## Tampermonkey userscript

- The userscript runs on pages you visit so that its keyboard shortcut and overlay are available. It does not read or transmit page content.
- It uses `@connect *` because the user chooses arbitrary API and specification URLs.
- It stores settings and history with `GM_getValue` / `GM_setValue`, or browser local storage if Tampermonkey storage is unavailable.
- It injects the app into an isolated shadow root. It does not modify the page's DOM outside that overlay.

## MCP server

- The MCP server is a local process started by your AI agent. It binds only to `127.0.0.1` and serves the built RouteCraft app to your browser.
- The page receives a random per-process token for the local request proxy. The token is not stored on disk and changes when the server restarts.
- Requests are sent from your machine to the API URL you or the agent chose. There is no RouteCraft proxy server controlled by the developer.
- The server stops when the MCP process exits or when `close_swagger` is called. It does not write request data to disk.

## Data retention and deletion

All stored data is local to your browser profile.

- Use **Clear history** in the History drawer to delete request history.
- Use **Clear all** in the Authorize dialog to remove stored API credentials.
- Use **Close** on the current spec card to stop remembering the last spec URL.
- One-time spec headers expire after two minutes and are cleared when the browser session ends.
- Removing the extension, removing the userscript, or clearing its stored data removes all of its local storage.

## Children's privacy

RouteCraft is a developer tool and is not directed at children. It does not knowingly collect personal information from anyone.

## Changes

Material changes to this policy will be published in this repository and, where relevant, in the Chrome Web Store listing.

## Contact

For privacy questions, open an issue at the project's GitHub repository:

https://github.com/anikethana21/routecraft/issues

