# RouteCraft MCP

RouteCraft as a tool for AI coding agents. The server opens a real browser tab with the RouteCraft UI and gives the agent a CORS-free HTTP client for the same API.

It is useful when an agent can write code but cannot show the user the live API docs, or when browser CORS blocks a localhost API. The MCP server starts a loopback-only app server, injects a request bridge into the page, and opens the user's default browser.

## Tools

| Tool | What it does |
| --- | --- |
| `open_swagger` | Opens RouteCraft with a spec loaded. Accepts `specUrl`, optional `operation` (for example `GET /pets`), `serverUrl` and `openBrowser`. Returns the app URL. |
| `inspect_spec` | Fetches an OpenAPI 2.0/3.0/3.1 JSON or YAML document and returns its title, version, servers, security schemes and operations. |
| `http_request` | Sends an HTTP request from the MCP process, outside the browser's CORS sandbox, and returns status, headers, body and latency. |
| `close_swagger` | Stops the local app/proxy server. |

The browser page also has a deep link:

```text
http://127.0.0.1:4199/?url=<spec>&operation=GET%20%2Fpets&server=http%3A%2F%2Flocalhost%3A8000
```

`operation` expands the matching endpoint. `server` overrides the spec's server URL.

## Use from this repository

```bash
npm install
npm run build
node mcp/server.mjs open http://127.0.0.1:8010/openapi.json
```

That command starts the app server and opens the default browser. Press `Ctrl+C` to stop it.

For stdio MCP clients, run `node mcp/server.mjs` with no arguments. The server prints logs to stderr and speaks MCP over stdout.

### Claude Code

```bash
claude mcp add routecraft -- node /absolute/path/to/routecraft/mcp/server.mjs
```

Or add this to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "routecraft": {
      "command": "node",
      "args": ["/absolute/path/to/routecraft/mcp/server.mjs"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "routecraft": {
      "command": "node",
      "args": ["/absolute/path/to/routecraft/mcp/server.mjs"]
    }
  }
}
```

### OpenCode

Add to `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "routecraft": {
      "type": "local",
      "command": ["node", "mcp/server.mjs"],
      "cwd": "/absolute/path/to/routecraft",
      "enabled": true
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "routecraft": {
      "command": "node",
      "args": ["/absolute/path/to/routecraft/mcp/server.mjs"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "routecraft": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/routecraft/mcp/server.mjs"]
    }
  }
}
```

Any other client that supports stdio MCP servers can use `node /absolute/path/to/routecraft/mcp/server.mjs` as the command.

## Use from npm

The package is prepared as `routecraft-mcp`. After it is published:

```bash
npx -y routecraft-mcp open http://127.0.0.1:8000/openapi.json
```

And in an MCP client:

```json
{
  "mcpServers": {
    "routecraft": {
      "command": "npx",
      "args": ["-y", "routecraft-mcp"]
    }
  }
}
```

To build the publishable package locally:

```bash
npm run package:mcp
npm publish ./mcp
```

`npm run package:mcp` rebuilds the web app, copies `dist/`, `LICENSE` and the Agent Skill into `mcp/`, and leaves the package ready for `npm publish`. Publishing requires an npm login.

## How the zero-CORS bridge works

The app server binds only to `127.0.0.1`. It serves the built RouteCraft app and injects a small script that defines the same request bridge used by the Tampermonkey build. That bridge posts to `/__proxy`, which uses Node's `fetch` and returns the response to the page. The proxy requires a random per-process token, so other web pages cannot read responses through it.

The browser tab is a normal tab. It does not need the Chrome extension or Tampermonkey. The app server must stay running while the tab is in use; it stops when the MCP process exits or when `close_swagger` is called.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROUTECRAFT_PORT` | `4199` | Preferred loopback port. The server tries a few nearby ports if it is busy. |
| `ROUTECRAFT_NO_BROWSER` | unset | Set to `1` to return the app URL without opening a browser. Useful in tests and headless agents. |
| `ROUTECRAFT_DIST` | detected | Override the directory containing the built RouteCraft app. |

## Development

```bash
npm run build
npm run test:mcp
```

`test:mcp` connects to the server with the official MCP client, exercises every tool, loads the generated page in Chromium, verifies the `?operation=` deep link, and proves a CORS-free request succeeds through the injected bridge.

The Agent Skill that tells agents when to use these tools lives at `.claude/skills/routecraft/SKILL.md` in the repository and is included in the npm package as `skill/SKILL.md`.

