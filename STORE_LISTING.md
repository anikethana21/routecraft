# Chrome Web Store listing

Copy and assets for the RouteCraft Chrome Web Store submission.

## Basic details

| Field | Value |
| --- | --- |
| Name | RouteCraft |
| Version | 2.3.1 |
| Category | Developer Tools |
| Language | English (United States) |
| Homepage | https://anikethana21.github.io/routecraft/ |
| Support | https://github.com/anikethana21/routecraft/issues |
| Privacy policy | https://github.com/anikethana21/routecraft/blob/main/PRIVACY.md |
| Package | `routecraft-extension.zip` |

### Short description (132 character limit)

> Read any OpenAPI or Swagger document and send requests from the same clean page. Zero-CORS execution for any API.

### Detailed description

> **Read the docs. Send the request.**
>
> RouteCraft turns any OpenAPI or Swagger document into clean, readable API documentation â€” and lets you execute every endpoint from the same page. No account, no collections, no context switching.
>
> **Works with every stack**
> Load OpenAPI 3.1, 3.0 and Swagger 2.0 documents from FastAPI, Express, Spring Boot, Flask, Django REST Framework, NestJS, ASP.NET Core, Go and any other framework that produces a spec. Load by URL, drag and drop a file, or paste JSON/YAML.
>
> **Documentation that stays out of the way**
> Familiar Swagger UI / FastAPI-style layout with tags, method-colored endpoint cards, parameter tables, request bodies, response schemas and an expandable schema browser. Every response has a media-type selector plus Example Value and Schema tabs. Filter endpoints instantly. Switch servers or edit the base URL.
>
> **An API client built into the page**
> Open an endpoint, click Try it out, fill in path, query and header parameters, edit the generated request body and press Execute. Inspect status, latency, response size, headers and formatted JSON. Copy or download the response.
>
> **Request console**
> Need something outside the spec? The Request tab is a free-form HTTP console with query parameters, headers, JSON, form, multipart text and plain-text bodies.
>
> **Authorization**
> Bearer tokens, Basic auth, API keys, OAuth 2.0 token exchange and OpenID Connect tokens. Credentials stay in your browser and are applied automatically to operations that declare them.
>
> **Zero-CORS**
> The extension's background service worker sends requests without browser CORS restrictions. This also applies to OAuth token endpoints and protected spec documents launched with a header, making localhost and locked-down APIs work from one place.
>
> **Launch your way**
> Click the toolbar icon for a compact popup, open the API shown in your current tab, or type `os 8010` in the address bar to jump straight to a local API. The same field accepts a full spec URL or `-H "Authorization: Bearer ..."` for a protected document.
>
> **History and code generation**
> Every request is recorded locally and can be replayed, searched, exported or deleted. Generate code in cURL, JavaScript, Axios, Python, Go, PHP, Ruby, Java, C#, HTTPie or PowerShell.
>
> **Private by design**
> No sign-in, no analytics, no developer-operated proxy, no remote code. Requests go only to the URLs you choose.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `tabs` | Open or focus the full-tab app and let the toolbar popup use the current tab's origin, so the app can look for that site's OpenAPI document. |
| `storage` | Keep a protected spec's one-time launch headers in session storage for at most two minutes. General settings, credentials and history stay in local browser storage. |
| `sidePanel` | Provide the optional side-panel version of the app. |
| Host permission `<all_urls>` | The extension is a general-purpose API client. Users choose arbitrary local (`localhost`) and remote API/spec URLs, so the host cannot be predicted in advance. It is used only for user-initiated spec loads and HTTP requests. |

### Does the extension use remote code?

No. All JavaScript and CSS are bundled in the package. It does not load scripts from a CDN or remote server.

### Single purpose

Read OpenAPI/Swagger documentation and execute HTTP requests against the APIs the user selects.

## Data usage disclosures

- The extension does **not** collect or transmit personal data to the developer.
- It stores the user's theme, recent spec URLs, drafts, history and API credentials locally in the browser profile.
- Protected-spec launch headers are kept in session storage for up to two minutes and are not written to disk.
- Request content and credentials are sent only to the API URL selected by the user.
- No analytics, tracking, advertising or sale of data.
- The privacy policy URL above must be entered in the Web Store dashboard.

## Assets

All paths are relative to the repository root.

| Asset | Size | Path |
| --- | --- | --- |
| Store icon | 128Ã—128 | `public/icons/icon128.png` |
| Screenshot 1 â€” landing | 1280Ã—800 | `store-assets/01-landing.png` |
| Screenshot 2 â€” documentation | 1280Ã—800 | `store-assets/02-docs.png` |
| Screenshot 3 â€” run request | 1280Ã—800 | `store-assets/03-run-request.png` |
| Screenshot 4 â€” request console | 1280Ã—800 | `store-assets/04-request-console.png` |
| Screenshot 5 â€” dark mode | 1280Ã—800 | `store-assets/05-dark-mode.png` |
| Small promo tile | 440Ã—280 | `store-assets/promo-tile-440x280.png` |
| Marquee promo image | 1400Ã—560 | `store-assets/promo-marquee-1400x560.png` |

## Submission checklist

1. `npm ci`
2. `npm run test:all`
3. `npm run package:extension`
4. Verify the zip contains `manifest.json` at its root.
5. Upload `routecraft-extension.zip` in the Chrome Web Store developer dashboard.
6. Add screenshots, promo tile, privacy policy URL, support URL and the permission justifications above.
7. Submit for review.

## Reviewer notes

- Load the extension and click the toolbar icon. The popup can open the full app, open the current tab's API, or quick-launch a port/spec URL.
- Enter `https://petstore3.swagger.io/api/v3/openapi.json` â€” or a local URL such as `http://127.0.0.1:8000/openapi.json`.
- In the address bar, type `rc`, press **Space**, then `8010` to launch `http://127.0.0.1:8010`. A full URL and `-H "Authorization: Bearer ..."` are also accepted.
- The **Request** tab accepts any HTTP URL.
- Credentials are optional. No account is needed to test any feature.
- The optional development mock API (`npm run api`) is not part of the extension package.

