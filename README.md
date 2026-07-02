# @uigraph/mcp

Connect Cursor to UIGraph MCP with a local stdio proxy. The proxy only needs the
MCP server URL — all login is handled by the MCP server.

---

## 1. Add to Cursor

Open your MCP config and add:

```json
{
  "servers": {
    "uigraph": {
      "command": "uigraph-mcp",
      "env": {
        "UIGRAPH_MCP_SERVER_URL": "https://mcp.uigraph.app"
      }
    }
  }
}
```

Or run:

```bash
npx @uigraph/mcp init cursor
```

`init cursor` installs `@uigraph/mcp` globally with `npm i -g @uigraph/mcp` only if `uigraph-mcp` is not already available on PATH.

---

## 2. Login once

```bash
npx @uigraph/mcp auth login
```

You'll be asked to choose:

- **Service Account** — paste a service-account token (the `uig_…` token from UIGraph).
- **User Account** — opens a browser; the MCP server redirects you to the UIGraph
  frontend to sign in, then hands the token back automatically.

Credentials are stored in your OS keychain.

For CI/automation, set `UIGRAPH_ACCESS_TOKEN` (a service-account token) instead of logging in.

---

## 3. Start using it

- Open Cursor
- The MCP proxy starts automatically
- Use UIGraph tools directly in chat

---

## Auth commands

```bash
npx @uigraph/mcp auth status
npx @uigraph/mcp auth logout
```

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `UIGRAPH_MCP_SERVER_URL` | yes | Base URL of the UIGraph MCP server |
| `UIGRAPH_ACCESS_TOKEN` | no | Service-account token for non-interactive use |

---

## How it works

```text
Cursor (stdio)
   ↓
@uigraph/mcp (this proxy)
   ↓
HTTPS (Authorization: Bearer <token>)
   ↓
UIGraph MCP Server
```

The proxy:

- Reads JSON-RPC messages from stdin
- For user login: opens the MCP server's `/auth/login`, which brokers the browser
  sign-in via the UIGraph frontend and returns a token to a local callback
- Attaches the stored (or `UIGRAPH_ACCESS_TOKEN`) token as a Bearer header
- Forwards requests to the MCP server and returns responses to stdout

It does not implement tools or business logic.
