# CSRF Protection Architecture Design

## Overview
Implement Double-Submit Cookie pattern combined with Token-based validation for CSRF protection on state-changing operations.

## Architecture Decision

### Pattern: Dual-Layer CSRF Protection
1. **Session-based CSRF Token** - Tied to user session, stored in database
2. **SameSite Cookie** - SameSite=Strict prevents automatic browser transmission
3. **Header Validation** - Require explicit X-CSRF-Token header (not form field)

### Why This Approach
- **SameSite=Strict**: Prevents cross-site cookie transmission (modern browser protection)
- **Token Validation**: Defense-in-depth for older browsers or custom clients
- **Database Storage**: Enables token expiry, rotation, and audit logging
- **Header-based**: More secure than form fields (not logged in URLs)

## Token Lifecycle

```
1. User visits login page (GET /auth/csrf)
   → Backend generates cryptographically random token
   → Backend stores token in database with expiry (1 hour)
   → Backend returns token in response headers
   → Frontend stores token in memory + localStorage

2. User submits login form (POST /auth/login)
   → Frontend includes token in X-CSRF-Token header
   → Middleware validates token matches session
   → Middleware checks token not expired
   → Middleware checks token not already used
   → If valid: allow request, optionally rotate token
   → If invalid: return 403 Forbidden

3. User receives response
   → New CSRF token included in response (for next request)
   → Frontend updates stored token

4. Token Expiry
   → Tokens expire after 1 hour
   → Database cleans up expired tokens
   → Frontend detects 403 and fetches new token
```

## Database Schema

```sql
CREATE TABLE "CsrfToken" (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL,  -- Hash for lookup
  user_id TEXT REFERENCES "User"(id) ON DELETE CASCADE,
  session_id TEXT,  -- Optional: tie to specific session
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,  -- 1 hour from creation
  used_at TIMESTAMP,  -- Set when token is used
  rotated_from VARCHAR(255),  -- Reference to previous token (for audit)
  
  INDEX(token_hash),
  INDEX(user_id, created_at),
  INDEX(expires_at)
);
```

Note: We use `token_hash` for lookup (never store raw token in easily-searchable form). The `token` is returned to client but stored as hash server-side.

## Backend Implementation

### Endpoint: GET /auth/csrf
```
Purpose: Generate CSRF token for unauthenticated users
Request: GET /auth/csrf
Response: {
  "token": "abc123...",  // 32 bytes hex (64 chars)
  "expiresAt": "2026-07-21T10:00:00Z"
}
```

### Middleware: csrfProtection
```typescript
// Apply to POST/PUT/DELETE auth endpoints
// Skip GET and HEAD requests (safe methods)
// Validate X-CSRF-Token header OR csrf form field

1. Extract token from header: req.headers['x-csrf-token']
2. If header missing, check form body: req.body.csrfToken
3. Hash token for lookup: hash(token)
4. Query database: SELECT ... WHERE token_hash = ?
5. Validate:
   - Token exists
   - Token not expired (expires_at > now)
   - Token belongs to user's session (if authenticated)
   - Token not already used (used_at IS NULL)
6. If valid:
   - Mark token as used: UPDATE ... SET used_at = now
   - Generate new token for response
   - Continue to next middleware
7. If invalid:
   - Log attempt (security audit)
   - Return 403 Forbidden
```

### New Utility: utils/csrf.ts
```typescript
export class CsrfManager {
  // Generate random token (32 bytes = 256 bits)
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Hash token for storage (never store plaintext)
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Validate token format
  static isValidToken(token: string): boolean {
    return /^[a-f0-9]{64}$/.test(token); // 256 bits in hex
  }

  // Compare tokens safely (timing-attack resistant)
  static compareTokens(a: string, b: string): boolean {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
```

## Frontend Implementation

### Hook: useCsrfToken.ts
```typescript
export function useCsrfToken() {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Try to get from memory (for performance)
    const cachedToken = sessionStorage.getItem('csrf-token');
    if (cachedToken) {
      setToken(cachedToken);
      setIsLoading(false);
      return;
    }

    // 2. Fetch from backend
    fetchCsrfToken().then((newToken) => {
      setToken(newToken);
      sessionStorage.setItem('csrf-token', newToken);
      setIsLoading(false);
    });
  }, []);

  const refreshToken = async () => {
    const newToken = await fetchCsrfToken();
    setToken(newToken);
    sessionStorage.setItem('csrf-token', newToken);
    return newToken;
  };

  return { token, isLoading, refreshToken };
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${API_URL}/auth/csrf`);
  const data = await response.json();
  return data.data.token;
}
```

### API Interceptor
```typescript
// In fetch wrapper or axios interceptor
// Add CSRF token to all state-changing requests

function addCsrfToken(options: RequestInit, token?: string | null) {
  if (!token) return options;

  return {
    ...options,
    headers: {
      ...options.headers,
      'X-CSRF-Token': token,
    },
  };
}

// Usage:
const token = useCsrfToken();
fetch('/auth/login', addCsrfToken(options, token.token));
```

## Security Considerations

✅ **Token Generation**
- Use crypto.randomBytes(32) for 256-bit entropy
- Never use Math.random() or predictable values
- Token format: 64-char hex string

✅ **Token Storage**
- Store hash in database (if attacker gets database, they can't use tokens)
- Never log raw tokens (grep-safe)
- Return raw token only in response (client needs it)

✅ **Token Expiry**
- Expire after 1 hour (balances security vs UX)
- Cleanup expired tokens daily
- Session timeout also invalidates token

✅ **Token Validation**
- Always validate token on state-changing requests
- Use timing-safe comparison (prevent timing attacks)
- Check token not already used (prevent replay)

✅ **SameSite Cookie**
- Set SameSite=Strict on session cookies
- Prevents browser from sending cookie on cross-site requests
- Defense-in-depth (header validation is second layer)

✅ **Error Handling**
- Don't reveal why CSRF validation failed (info leak)
- Return generic "403 Forbidden" message
- Log detailed reason server-side for security audit

✅ **Token Rotation**
- Option 1: Use-once tokens (rotate after each use)
- Option 2: Time-based rotation (rotate every 30 min)
- Implement Option 1 for higher security

✅ **Rate Limiting**
- Rate limit CSRF token generation: max 10 per minute per IP
- Prevent token enumeration attacks

## Testing Strategy

### Unit Tests
- Token generation produces valid format
- Token hash produces consistent hash
- Token expiry validation works
- Timing-safe comparison works

### Integration Tests
- GET /auth/csrf returns valid token
- Token accepted on POST /auth/login
- Expired token rejected with 403
- Invalid token rejected with 403
- Token consumed after use
- New token issued in response

### Security Tests
- CSRF attack simulation (cross-site POST) → 403
- Token reuse attempt → 403
- Token tampering → 403
- Expired token → 403

## Frontend Integration Points

1. **Login Page**
   - Fetch CSRF token before showing form
   - Auto-fill token in X-CSRF-Token header on submit

2. **Register Page**
   - Same as login

3. **Logout Endpoint**
   - Optional: protect with CSRF token (should require POST)

4. **Any State-Changing Endpoint**
   - Always require CSRF token in header

## Performance Impact

- **Token Generation**: < 1ms (crypto.randomBytes is fast)
- **Token Lookup**: O(1) with hash index (single row lookup)
- **Database Size**: ~500 bytes per token × max concurrent users × token lifetime
  - Example: 10,000 users × 3 active tokens each = 15MB per server

## Backward Compatibility

- New tokens required going forward
- Old sessions without tokens will get 403 (force refresh)
- Frontend auto-retries on 403 by fetching new token

## Migration Path

1. Deploy middleware with CSRF protection (disabled by default)
2. Deploy frontend with useCsrfToken hook (enabled)
3. Enable middleware in production (gradual rollout)
4. Monitor 403 errors in logs
5. Fully enable after testing

---

**Status**: Design Ready  
**Next Step**: Database Migration  
**Complexity**: Medium  
**Risk**: Low (well-established pattern)
