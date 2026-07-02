# UIGraph MCP Auth Design — Cognito Integration

**Status:** Draft  
**Author:** Head of Product  
**Date:** May 2026

---

## 1. Current Design

The current architecture uses a stdio local proxy pattern. Cursor talks to `@uigraph/mcp` via stdio, which then forwards to the remote MCP server over HTTPS with a static Bearer token.

```
Cursor (stdio)
  ↓
@uigraph/mcp (local proxy)
  ↓
HTTPS Authorization: Bearer <static token>
  ↓
Remote MCP Server
```

The transport is valid. The issue is authentication: the token is static, shared, and has no identity.

---

## 2. The Answer: Reuse AWS Cognito

UIGraph already uses AWS Cognito. Developers authenticate once and receive JWTs that can also be used by the MCP server.

- OAuth 2.1 / OIDC compliant
- JWT includes `iss`, `sub`, `exp`, `aud`
- MCP server validates via JWKS endpoint

**Key change:** replace static token with short-lived Cognito JWT stored in OS keychain and auto-refreshed.

---

## 3. Cognito Configuration Changes

### 3.1 New App Client — `uigraph-mcp`

| Setting | Value |
|--------|------|
| Type | Public client (PKCE) |
| OAuth flow | Authorization code + PKCE |
| Scopes | openid, profile, mcp/read |
| Callback | http://localhost:9876/callback |
| Access token | 1 hour |
| Refresh token | 30 days |

### 3.2 Resource Server — `mcp.uigraph.app`

| Setting | Value |
|--------|------|
| Identifier (aud) | https://mcp.uigraph.app |
| Scope | mcp/read |

### 3.3 Pre Token Generation Lambda

```js
exports.handler = async (event) => {
  const orgId = event.request.userAttributes['custom:orgId'];

  event.response = {
    claimsAndScopeOverrideDetails: {
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          'custom:orgId': orgId
        }
      }
    }
  };

  return event;
};
```

---

## 4. Architecture

### Path A — Cursor (stdio)

- `uigraph auth login` → browser login
- Token stored in keychain
- Proxy injects token
- Auto refresh via refresh token

### Path B — Claude / VS Code

- Native OAuth flow
- 401 → redirect → login → token

Both paths use identical JWT validation.

---

## 5. Token Validation

### JWKS Endpoint

```
https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json
```

### Required Claims

| Claim | Requirement |
|------|------------|
| iss | must match user pool |
| aud | https://mcp.uigraph.app |
| scope | includes mcp/read |
| exp | not expired |
| token_use | access |
| custom:orgId | present |
| sub | present |

### Node.js Validation

```js
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'access',
  clientId: process.env.COGNITO_MCP_CLIENT_ID,
});

async function validateToken(token) {
  const payload = await verifier.verify(token, {
    audience: 'https://mcp.uigraph.app',
  });

  const orgId = payload['custom:orgId'];
  const userId = payload.sub;

  if (!orgId) throw new Error('missing orgId');

  return { orgId, userId, scopes: payload.scope.split(' ') };
}
```

---

## 6. Developer Experience

1. `npm install -g @uigraph/cli`
2. `uigraph auth login`
3. `uigraph init`
4. Open Cursor

Auth becomes invisible after setup.

---

## 7. Before vs After

| Property | Static Token | Cognito |
|---------|-------------|--------|
| Expiry | Never | 1 hour |
| Identity | None | Per-user |
| Storage | .env | Keychain |
| Audit | None | Full |
| Revocation | Global | Per-user |

---

## 8. Implementation Plan

1. Create Cognito app client
2. Create resource server
3. Add Lambda
4. Build CLI login
5. Update proxy
6. Add JWT middleware
7. Add OAuth PRM
8. Add init command

---

## 9. What Not To Do

- Do not accept ID tokens
- Do not store tokens in `.env`
- Do not skip `aud` check
- Do not write custom JWT validation

---

# UIGraph MCP — Technical Design & Implementation Plan

**Status:** Draft  
**Author:** UIGraph Engineering  
**Date:** May 2026

---

## 1. Overview

MCP server exposing UIGraph knowledge graph to AI agents.

---

## 2. System Overview

```
Customer repo → uigraph sync → Adapter Service
  ↓
Layer 1: Chunk Translator
  ↓
Layer 2: Embedding Worker
  ↓
S3 Vectors
  ↓
MCP Server
  ↑
Proxy
  ↑
Cursor / Claude
```

---

## 3. Layer 1 — Chunk Translator

Inputs:
- context.json
- diagram.mmd

Outputs:
- chunks.json

Chunk types:
- Node
- Edge
- Decision
- Path
- SchemaLink

Key rules:
- `.mmd` defines topology
- `context.json` defines metadata
- Deterministic chunk IDs

---

## 4. Layer 2 — Embedding Worker

- Model: Titan v2 (1024 dim)
- Store: S3 Vectors
- Isolation: per-org index

Flow:

```
chunks.json → Lambda → Bedrock → vectors → S3
```

---

## 5. MCP Server

### Stack

- Node.js
- Express
- MCP SDK
- aws-jwt-verify

### Tools

- get_service
- find_dependencies
- search_diagram
- get_schema
- list_services

### search_diagram flow

1. Validate JWT
2. Embed query
3. Query S3 Vectors
4. Return top chunks

---

## 6. Local Proxy

Responsibilities:
- Read token from keychain
- Forward requests
- Refresh token

---

## 7. CLI Commands

### auth login

- Opens browser
- Stores token

### init

- Writes `.cursor/mcp.json`

---

## 8. Implementation Phases

### Phase 1 — Chunk Translator
- Build generators
- Add tests

### Phase 2 — Embedding
- Lambda
- S3 Vectors

### Phase 3 — MCP Server
- Tools
- Auth

### Phase 4 — Proxy + CLI
- auth login
- init

### Phase 5 — Live Updates
- SNS → SSE

### Phase 6 — OAuth Clients + Hardening
- Claude / VS Code
- Rate limiting
- Logging

---

## 9. Testing Strategy

- Unit: generators
- Integration: Lambda, tools
- E2E: full flow
- Security: token validation
- Performance: load test

---

## 10. Open Questions

- search ranking
- schema enrichment
- cross-diagram search
- proxy distribution

---

**Sources:**  
- fileciteturn0file0  
- fileciteturn0file1

