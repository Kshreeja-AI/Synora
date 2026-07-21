# Module 1: Authentication & Authorization - Completion Plan

**Status**: Implementation Roadmap (Planning Phase)  
**Target**: Production-Ready Auth System  
**Prepared**: 2026-07-21  
**Baseline**: Module 1 Gap Report (40% complete → 100% complete)

---

## Overview

This document provides a detailed implementation roadmap to bring Module 1 from 40% to 100% production-readiness. All gaps from the Gap Report are prioritized, sequenced by dependencies, and fully specified for implementation.

**Total Effort**: ~8-10 weeks for one team  
**Critical Path**: CSRF → MFA → Password Reset → Comprehensive Tests

---

## CRITICAL GAPS (Production Blockers)

These must be completed before any production deployment.

---

### Gap 1: Multi-Factor Authentication (2FA/MFA)

**Why Required**
- Enterprise security standard
- NIST recommends MFA for all user accounts
- Protects against credential compromise
- Required for SOC2/HIPAA compliance (Phase 4)
- Significantly reduces account takeover risk

**Priority**: 🔴 CRITICAL (Blocker for production)

**Dependencies**
- Must complete: Authentication base (signup/login/logout) ✅
- Must complete: Secrets Management (for TOTP secret storage) ✅
- Must complete: Database schema updates
- Parallel possible: Tests can be written in parallel

**Estimated Effort**: 3-4 weeks (full-stack implementation + testing)
- Design & specification: 2 days
- Backend implementation: 5-6 days
- Frontend implementation: 4-5 days
- Tests (unit + integration + E2E): 3-4 days
- Documentation: 2 days

**Database Changes**
```sql
-- New MFA configuration table
CREATE TABLE "MFAMethod" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- 'totp', 'sms', 'email'
  secret VARCHAR(255), -- Encrypted TOTP secret
  backup_codes JSONB, -- Array of recovery codes (hashed)
  is_enabled BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MFA attempt tracking
CREATE TABLE "MFAAttempt" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  method_type VARCHAR(20),
  success BOOLEAN,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address INET,
  user_agent TEXT,
  INDEX(user_id, attempted_at)
);

-- Add mfa_required flag to User
ALTER TABLE "User" ADD COLUMN mfa_enabled BOOLEAN DEFAULT false;
```

**Backend Work**
- `services/mfa/mfaService.ts` - Core MFA orchestrator
  - `generateTotpSecret()` - Create new TOTP secret
  - `verifyTotpCode()` - Verify 6-digit code
  - `generateBackupCodes()` - Generate recovery codes
  - `verifyBackupCode()` - Use recovery code (consume it)
  - `enableMfa()` - Turn on for user
  - `disableMfa()` - Turn off for user
  - `listActiveMethods()` - Get user's active MFA methods

- `routes/auth.ts` - New MFA endpoints
  - `POST /auth/mfa/setup` - Initiate MFA setup, return QR code
  - `POST /auth/mfa/verify` - Verify TOTP code during setup
  - `POST /auth/mfa/disable` - Disable MFA
  - `POST /auth/mfa/backup-codes` - Get new recovery codes

- `middleware/mfaMiddleware.ts` - MFA verification middleware
  - Check if user has MFA enabled
  - Route to MFA verification flow
  - Track MFA attempts
  - Lock account after N failed attempts

- Update `middleware/auth.ts`
  - Add MFA challenge flag to JWT payload
  - Implement `mfaChallengeToken` (separate short-lived token for MFA verification)
  - Allow access to /auth/mfa/verify endpoint only with mfaChallengeToken

- Update `routes/auth.ts` (login endpoint)
  - After password verification succeeds
  - If MFA enabled, return mfaChallengeToken (15-min expiry) instead of access token
  - Redirect client to MFA verification page
  - Only issue access token after TOTP verification

- Integrate with `secretsManager`
  - Store TOTP secrets encrypted via secrets manager
  - Never expose raw secrets to logs
  - Audit log MFA enable/disable events

**Frontend Work**
- `src/app/auth/mfa/setup.tsx` - MFA enrollment page
  - Display QR code (generate from backend)
  - Input field for manual key entry
  - User enters 6-digit code to verify
  - Display backup codes with copy/download option
  - Confirmation when MFA enabled

- `src/app/auth/mfa/verify.tsx` - MFA verification during login
  - Login redirects here if MFA enabled
  - 6-digit code input field
  - "Use recovery code" link (toggle to backup code entry)
  - Submit verification code
  - Handle failed attempts with countdown

- Update `src/app/auth/login/page.tsx`
  - After successful password entry
  - Check if MFA enabled
  - If yes, redirect to /auth/mfa/verify with mfaChallengeToken
  - If no, proceed with normal login

- `src/app/settings/security.tsx` (future: settings page)
  - Show MFA status
  - Button to enable/disable MFA
  - Download recovery codes
  - List backup codes usage

- `src/hooks/useMfa.ts` - Custom hook
  - Handle MFA verification flow
  - Manage recovery code state
  - Track MFA attempts

**API Changes**
```
POST   /auth/mfa/setup                # Initiate MFA, return QR code + secret
POST   /auth/mfa/verify               # Verify TOTP code (with mfaChallengeToken)
POST   /auth/mfa/disable              # Disable MFA (require password or recovery)
POST   /auth/mfa/backup-codes         # Generate new backup codes
GET    /auth/mfa/status               # Get MFA status for user
```

**Testing Requirements**
- ✅ Unit tests: TOTP generation/verification (use `speakeasy` library)
- ✅ Unit tests: Backup code generation/validation
- ✅ Integration tests: MFA setup flow (generate secret → verify code → enable)
- ✅ Integration tests: MFA login flow (password → MFA challenge → access token)
- ✅ Integration tests: Recovery code usage and consumption
- ✅ E2E tests: Full MFA enrollment → login → verification
- ✅ E2E tests: Recovery code flow
- ✅ Security tests: Invalid code rejection, attempt rate limiting, code expiry
- ✅ Coverage target: >90%

**Documentation Requirements**
- `docs/auth/MFA_SETUP.md` - User guide for enabling MFA
- `docs/auth/MFA_RECOVERY.md` - Recovery code management
- `docs/development/MFA_TESTING.md` - How to test MFA locally
- `docs/api/mfa-endpoints.md` - MFA API reference
- Update `docs/security.md` with MFA architecture

**Security Considerations**
- ✅ TOTP secrets encrypted at rest (via secretsManager)
- ✅ Never transmit raw secrets in logs
- ✅ Rate limiting on MFA verification (5 attempts per 15 min)
- ✅ Account lockout after N failed MFA attempts
- ✅ Recovery codes hashed (not plaintext) in database
- ✅ Recovery codes consumed after use (can't reuse)
- ✅ TOTP code expiry (standard 30-second window)
- ✅ Audit log all MFA events (enable, disable, successful verification, failed attempts)
- ✅ mfaChallengeToken must expire quickly (15 min)
- ✅ mfaChallengeToken only allows /auth/mfa/verify endpoint

**Dependencies Before Start**
- Authentication base system complete ✅
- SecretsManager complete ✅
- Database migrations working ✅
- Config system complete ✅

**Blocks**
- None

---

### Gap 2: CSRF Protection

**Why Required**
- Prevent cross-site request forgery attacks
- OWASP top 10 vulnerability
- Critical for state-changing operations (login, password change, account settings)
- Browsers don't enforce CSRF protection for POST requests

**Priority**: 🔴 CRITICAL (Blocker for production)

**Dependencies**
- Must complete: Session management ✅
- Must complete: Frontend session provider (Gap 7)
- Parallel possible: Can be implemented alongside password reset

**Estimated Effort**: 1-2 weeks
- Design & specification: 1 day
- Backend implementation: 2-3 days
- Frontend implementation: 2-3 days
- Tests: 2 days
- Documentation: 1 day

**Database Changes**
```sql
-- Store CSRF tokens
CREATE TABLE "CsrfToken" (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES "Session"(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(expires_at)
);
```

**Backend Work**
- `middleware/csrfProtection.ts` - CSRF middleware
  - Generate CSRF token per session
  - Store token in database with expiry
  - Validate token on state-changing requests (POST, PUT, DELETE)
  - Return token in response headers and cookies
  - Support token refresh

- Update `routes/auth.ts`
  - Generate CSRF token on login page load
  - Validate CSRF token on POST /auth/login, POST /auth/register
  - Include CSRF token in response

- `utils/csrf.ts` - Utility functions
  - `generateToken()` - Create cryptographically secure token
  - `validateToken(token, sessionId)` - Verify token
  - `refreshToken(oldToken)` - Generate new token

- Update error handling
  - Return 403 Forbidden for invalid CSRF token
  - Log CSRF token mismatch (potential attack)

**Frontend Work**
- `hooks/useCsrfToken.ts` - Custom hook
  - Fetch CSRF token on page load
  - Store token in memory + localStorage
  - Automatically include in all POST/PUT/DELETE requests
  - Handle token refresh

- Update all auth forms
  - Include hidden CSRF token field
  - OR include token in request headers (`X-CSRF-Token`)
  - Prefer header approach (cleaner)

- Update API client
  - Interceptor to add CSRF token to all state-changing requests
  - Handle 403 responses (invalid token)
  - Automatically refresh token if expired

**API Changes**
```
GET    /auth/csrf                     # Fetch CSRF token (GET is safe)
(All POST/PUT/DELETE auth endpoints require X-CSRF-Token header)
```

**Testing Requirements**
- ✅ Unit tests: CSRF token generation
- ✅ Unit tests: CSRF token validation
- ✅ Integration tests: Token generation per session
- ✅ Integration tests: Invalid token rejection (403)
- ✅ Integration tests: Token refresh
- ✅ E2E tests: CSRF protection on login/register/logout
- ✅ Security tests: Simulate CSRF attack (should fail)
- ✅ Coverage target: >85%

**Documentation Requirements**
- `docs/security/CSRF_PROTECTION.md` - How CSRF protection works
- `docs/api/csrf-endpoints.md` - CSRF API reference
- Update `docs/development/SECURITY_TESTING.md` - How to test CSRF locally

**Security Considerations**
- ✅ Tokens cryptographically random (crypto.randomBytes)
- ✅ Tokens expire after 1 hour or session end
- ✅ Tokens tied to specific session (not transferable)
- ✅ Tokens consumed after use (or rotated)
- ✅ Audit log CSRF token mismatches (potential attacks)
- ✅ Rate limiting on CSRF token generation (prevent flooding)
- ✅ SameSite=Strict on session cookies (additional protection)

**Dependencies Before Start**
- Session management ✅
- Session middleware ✅
- Frontend session provider (needed for token management)

**Blocks**
- None (can start immediately)

---

### Gap 3: Password Reset / Account Recovery

**Why Required**
- Users lock themselves out of accounts
- Essential user experience feature
- Enables password change flow
- Required for GDPR compliance (account access rights)

**Priority**: 🔴 CRITICAL (Blocker for production)

**Dependencies**
- Must complete: Authentication base ✅
- Must complete: Email delivery (future: Phase 2 - async jobs)
- Must complete: Secrets Management ✅
- Must complete: Session management ✅

**Estimated Effort**: 2-3 weeks
- Design & specification: 2 days
- Backend implementation: 4-5 days (email integration + token handling)
- Frontend implementation: 3-4 days (reset form + email verification)
- Tests: 3 days
- Documentation: 1 day
- Email template design: 1 day

**Database Changes**
```sql
-- Password reset tokens
CREATE TABLE "PasswordResetToken" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL, -- Hash of token for lookup
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL, -- 1 hour expiry
  used_at TIMESTAMP,
  used_ip_address INET,
  INDEX(user_id, created_at),
  INDEX(expires_at)
);

-- Password history (for strength requirements + prevent reuse)
CREATE TABLE "PasswordHistory" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Keep last 5 passwords, delete older ones
  INDEX(user_id, created_at)
);

-- Password change audit
CREATE TABLE "PasswordChangeLog" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  change_type VARCHAR(20), -- 'manual', 'reset', 'expired'
  changed_by VARCHAR(50), -- 'user', 'admin', 'system'
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address INET,
  user_agent TEXT,
  INDEX(user_id, changed_at)
);

-- Add password_changed_at to User table
ALTER TABLE "User" ADD COLUMN password_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

**Backend Work**
- `services/passwordResetService.ts` - Core password reset logic
  - `requestPasswordReset(email)` - Send reset email
  - `validateResetToken(token)` - Check token validity
  - `resetPassword(token, newPassword)` - Apply password change
  - `getPasswordHistory(userId)` - Get previous passwords
  - `isPasswordReusedRecently(userId, password)` - Check reuse
  - `hashPassword(password)` - Use bcryptjs (12 rounds)

- Update `routes/auth.ts`
  - `POST /auth/password/reset` - Request password reset (email)
  - `POST /auth/password/reset/:token` - Complete reset (new password)
  - `GET /auth/password/reset/:token` - Validate token (frontend before form)

- `services/email/emailService.ts` (NEW - can be stubbed initially)
  - `sendPasswordResetEmail(email, token, name)` - Send HTML email
  - Template with reset link, expiry, account info
  - Fallback email delivery (log to console initially)

- Security utilities
  - Token generation: `crypto.randomBytes(32).toString('hex')`
  - Token hashing for database storage (never store plaintext)
  - Token expiry validation (1 hour)
  - Rate limiting: max 5 reset requests per hour per email

- Update `middleware/auth.ts`
  - Add password expiry check (warn after 90 days)
  - Force password change prompt on next login if expired

**Frontend Work**
- `src/app/auth/forgot-password.tsx` - Request password reset
  - Email input field
  - Submit button
  - Success message with "Check your email"
  - Resend email link (rate limited)
  - Link back to login

- `src/app/auth/reset-password/[token].tsx` - Reset password form
  - Validate token (GET /auth/password/reset/:token)
  - New password field (with strength meter)
  - Confirm password field
  - Password requirements display (8+ chars, upper, lower, number, special)
  - Submit button
  - Error handling (expired token, invalid token, etc.)

- Password strength meter component
  - Real-time validation
  - Visual feedback (red → yellow → green)
  - Display which requirements are met
  - Disable submit until strong password

- Update `src/app/auth/login/page.tsx`
  - Add "Forgot password?" link
  - Links to `/auth/forgot-password`

- `hooks/usePasswordReset.ts` - Custom hook
  - Handle reset flow state
  - API calls to backend
  - Error handling

**API Changes**
```
POST   /auth/password/reset              # Request reset (send email)
  Request: { email: string }
  Response: { message: "Check your email" }

GET    /auth/password/reset/:token       # Validate token
  Response: { valid: boolean, email: string? }

POST   /auth/password/reset/:token       # Complete reset (new password)
  Request: { newPassword: string }
  Response: { success: boolean }
```

**Testing Requirements**
- ✅ Unit tests: Token generation/validation
- ✅ Unit tests: Password strength validation
- ✅ Unit tests: Password hash comparison
- ✅ Unit tests: Password reuse prevention
- ✅ Integration tests: Reset request flow (email generation)
- ✅ Integration tests: Reset completion flow
- ✅ Integration tests: Token expiry validation
- ✅ Integration tests: Rate limiting on requests
- ✅ E2E tests: Full password reset flow (request → email → reset)
- ✅ E2E tests: Invalid token handling
- ✅ E2E tests: Expired token handling
- ✅ Security tests: Timing attack resistance (token comparison)
- ✅ Coverage target: >85%

**Documentation Requirements**
- `docs/auth/PASSWORD_RESET.md` - User guide
- `docs/api/password-endpoints.md` - API reference
- Email template documentation
- Troubleshooting guide (email not arriving, token invalid, etc.)

**Security Considerations**
- ✅ Tokens single-use (consumed after reset)
- ✅ Tokens expire after 1 hour
- ✅ Tokens cryptographically random
- ✅ Never send token in URL query string (use POST or hash in URL)
- ✅ Rate limiting: max 5 requests per hour per email
- ✅ Account lockout: none (this is reset flow, not login)
- ✅ Audit log password resets (who, when, from where)
- ✅ Send security alert email: "Password was reset. If not you, contact support"
- ✅ Verify email matches account (prevent account enumeration)
- ✅ Password requirements enforced (complexity, length, etc.)
- ✅ Don't allow reuse of last 5 passwords
- ✅ Force MFA re-verification after password reset

**Dependencies Before Start**
- Authentication base ✅
- SecretsManager ✅
- (Email service can be stubbed; implement fully in Phase 2)

**Blocks**
- Email service (can be mocked initially, implemented in Phase 2)

---

### Gap 4: Comprehensive Authentication Tests

**Why Required**
- Current test coverage: 15% (only utility functions)
- Auth is security-critical; needs >85% coverage
- Gaps in edge case testing (expired tokens, invalid credentials, rate limiting, etc.)
- Integration and E2E tests missing entirely

**Priority**: 🔴 CRITICAL (Blocker for production)

**Dependencies**
- Must complete: All auth endpoints ✅
- Must complete: Middleware ✅
- Parallel: Can write tests alongside implementation of above features

**Estimated Effort**: 2-3 weeks
- Test infrastructure setup: 2 days
- Unit tests: 3-4 days
- Integration tests: 4-5 days
- E2E tests: 3-4 days
- Documentation: 1 day

**Database Changes**
```sql
-- Test fixtures (optional, can use factories instead)
-- No schema changes needed; use existing auth tables
-- Test database can be ephemeral per test run
```

**Backend Work**
- `tests/auth/auth.test.ts` - Comprehensive auth test suite
  - Test signup flow (valid/invalid email, weak password, duplicate account)
  - Test login flow (correct/wrong password, non-existent account, account locked)
  - Test token refresh (valid/expired tokens)
  - Test logout (token invalidation)
  - Test JWT verification (valid/invalid/expired tokens)
  - Test rate limiting (too many login attempts)
  - Test session management (concurrent sessions, logout all)

- `tests/auth/mfa.test.ts` - MFA test suite (after MFA implementation)
  - Test TOTP setup flow
  - Test TOTP verification (valid/invalid/expired codes)
  - Test backup codes (generation, usage, consumption)
  - Test MFA-required login flow

- `tests/auth/passwordReset.test.ts` - Password reset tests
  - Test reset request (valid/invalid email)
  - Test reset completion (valid/invalid/expired tokens)
  - Test password strength validation
  - Test password reuse prevention
  - Test rate limiting on reset requests

- `tests/auth/csrf.test.ts` - CSRF protection tests
  - Test CSRF token generation
  - Test CSRF token validation (valid/invalid/expired)
  - Test state-changing requests (require CSRF token)
  - Test CSRF mismatch detection

- `tests/fixtures/authFixtures.ts` - Test data factories
  - Create test users with various states
  - Generate valid/invalid tokens
  - Seed test database

- Use testing libraries:
  - Jest for unit tests
  - Supertest for integration tests (HTTP assertions)
  - Test database (separate from production)

**Frontend Work**
- `tests/auth/login.test.tsx` - Login UI tests
  - Test form rendering
  - Test email/password input validation
  - Test submit behavior (loading state, errors)
  - Test error message display
  - Test navigation after successful login

- `tests/auth/register.test.tsx` - Register UI tests
  - Test form rendering
  - Test password strength meter
  - Test submit behavior
  - Test success/error handling

- `tests/auth/passwordReset.test.tsx` - Password reset UI tests (when implemented)
  - Test token validation UI
  - Test password reset form
  - Test success/error handling

- Use testing libraries:
  - React Testing Library for component tests
  - Mock fetch for API calls
  - Mock router for navigation

**API Changes**
- No new endpoints; test all existing endpoints

**Testing Requirements**
- ✅ Unit tests: Password hashing, JWT signing/verification, token validation
- ✅ Unit tests: Rate limiting logic
- ✅ Unit tests: Session management
- ✅ Integration tests: Full signup flow (validation → database → response)
- ✅ Integration tests: Full login flow
- ✅ Integration tests: Token refresh
- ✅ Integration tests: Logout
- ✅ Integration tests: Rate limiting enforcement
- ✅ E2E tests: Full auth journey (signup → login → logout)
- ✅ E2E tests: Password reset flow
- ✅ E2E tests: Session management
- ✅ Security tests: SQL injection attempts, XSS payloads, timing attacks
- ✅ Performance tests: Login latency, concurrent logins
- ✅ Coverage target: >85% (currently 15%)

**Documentation Requirements**
- `docs/development/AUTH_TESTING.md` - How to run auth tests
- `docs/development/TEST_FIXTURES.md` - Test data and factories
- Test coverage report documentation

**Security Considerations**
- ✅ Test invalid/malicious inputs
- ✅ Test rate limiting (DOS protection)
- ✅ Test token expiry
- ✅ Test password validation
- ✅ Test session fixation prevention
- ✅ Test privilege escalation attempts
- ✅ Use random test data (avoid predictable patterns)
- ✅ Clean up test data after each test

**Dependencies Before Start**
- All auth endpoints implemented ✅ (partially; some will be added)

**Blocks**
- None; can start immediately for existing features

---

### Gap 5: Audit Logging for Auth Events

**Why Required**
- Track suspicious activity (brute force, account takeovers)
- Compliance requirement (GDPR, SOC2, HIPAA)
- Incident investigation
- Security monitoring and alerting

**Priority**: 🔴 CRITICAL (Blocker for production)

**Dependencies**
- Must complete: Audit log infrastructure (partially done via SecretsManager)
- Must complete: Logging middleware ✅
- Parallel: Can implement alongside other auth work

**Estimated Effort**: 1 week
- Backend implementation: 2-3 days
- Tests: 2 days
- Documentation: 1 day

**Database Changes**
```sql
-- Extend existing AuditLog table or create auth-specific audit log
CREATE TABLE "AuthAuditLog" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL, -- 'login', 'login_failed', 'logout', 'password_reset', 'mfa_enable', 'mfa_disable', 'mfa_failed', 'token_refresh', etc.
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'blocked'
  ip_address INET,
  user_agent TEXT,
  error_reason TEXT, -- 'invalid_password', 'account_locked', 'mfa_failed', etc.
  additional_data JSONB, -- {device: 'mobile', location: 'US', etc.}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(event_type, created_at),
  INDEX(ip_address, created_at)
);

-- Track failed login attempts for rate limiting
CREATE TABLE "LoginAttempt" (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  ip_address INET,
  success BOOLEAN,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email, ip_address, attempted_at) -- Prevent duplication
);
```

**Backend Work**
- `services/auditLog/authAuditService.ts` - Auth-specific audit logging
  - `logLoginAttempt(email, success, ipAddress, userAgent, reason?)` - Track logins
  - `logLogout(userId, ipAddress)` - Track logouts
  - `logPasswordReset(userId, ipAddress, success)` - Track password resets
  - `logMfaEvent(userId, event, success, ipAddress)` - Track MFA events
  - `logTokenRefresh(userId, ipAddress)` - Track token refreshes
  - `logSessionCreation(userId, ipAddress, userAgent)` - Track sessions
  - `logAnomalousActivity(userId, reason, ipAddress)` - Track suspicious activity

- Update all auth routes to log events
  - Login route: log success/failure
  - Logout route: log logout
  - Password reset route: log reset attempt
  - MFA routes: log enable/disable/verification

- Integrate with rate limiting
  - Query LoginAttempt table to enforce limits
  - Log rate limit blocks

- Middleware to capture request context
  - IP address
  - User agent
  - Request timing

**Frontend Work**
- No frontend changes needed (logging is backend-only)
- Optional: User can view their auth activity in settings page (future feature)

**API Changes**
- No new endpoints
- Logging happens transparently in background

**Testing Requirements**
- ✅ Unit tests: Audit log entry creation
- ✅ Integration tests: Login events are logged
- ✅ Integration tests: Failed login tracking
- ✅ Integration tests: Password reset logging
- ✅ Integration tests: MFA events logged
- ✅ Coverage target: >80%

**Documentation Requirements**
- `docs/security/AUTH_AUDIT_LOGGING.md` - Audit log design
- `docs/operations/AUTH_MONITORING.md` - How to monitor auth events
- Log event types and meanings reference

**Security Considerations**
- ✅ Never log passwords or secrets
- ✅ Store audit logs immutably (append-only, no deletes)
- ✅ Audit logs retained for compliance periods (1+ year)
- ✅ Restrict read access to audit logs (admin only)
- ✅ Log both success and failures
- ✅ Include context (IP, user agent, timestamp)
- ✅ Detect patterns (brute force = 5+ failed logins in 15 min)
- ✅ Alert on suspicious patterns (future: Phase 3 monitoring)

**Dependencies Before Start**
- Logging infrastructure ✅
- Database ✅

**Blocks**
- None

---

## HIGH PRIORITY GAPS

These should be completed before or very soon after critical gaps.

---

### Gap 6: Complete OAuth2 Implementation

**Why Required**
- Social login (Google, GitHub) reduces friction
- Many users prefer OAuth to password registration
- Supports enterprise federation (SSO)
- Required for Phase 4 SSO/SAML work

**Priority**: 🟠 HIGH (Production feature, but less critical than MFA)

**Dependencies**
- Must complete: Authentication base ✅
- Must complete: Secrets Management ✅ (for OAuth credentials)
- Parallel: Can implement alongside MFA

**Estimated Effort**: 2-3 weeks
- Backend OAuth flow: 4-5 days
- Frontend OAuth UI: 2-3 days
- Tests: 2 days
- Documentation: 1 day

**Database Changes**
```sql
-- Extend Account table (already designed)
-- Add fields for OAuth metadata
ALTER TABLE "Account" ADD COLUMN last_used_at TIMESTAMP;
ALTER TABLE "Account" ADD COLUMN scope VARCHAR(255); -- OAuth scope granted
ALTER TABLE "Account" ADD COLUMN raw_data JSONB; -- Store provider metadata
```

**Backend Work**
- `services/oauth/oauthService.ts` - OAuth orchestrator
  - `initiateOauthFlow(provider, callbackUrl)` - Generate state, return auth URL
  - `handleOauthCallback(provider, code, state)` - Exchange code for token
  - `getUserFromProvider(provider, accessToken)` - Fetch user info
  - `linkOauthAccount(userId, provider, providerData)` - Link to existing account
  - `findOrCreateUser(provider, providerData)` - Just-in-time provisioning

- `routes/auth.ts` - OAuth endpoints
  - `GET /auth/oauth/:provider` - Redirect to provider (Google, GitHub)
  - `GET /auth/oauth/:provider/callback` - Handle provider callback

- OAuth provider adapters
  - `services/oauth/providers/googleOauthProvider.ts`
  - `services/oauth/providers/githubOauthProvider.ts`
  - Fetch from provider's token endpoint
  - Fetch user profile
  - Map provider fields to Synora User

- Session management
  - Store state token in database (CSRF-like protection)
  - Validate state in callback
  - Create session after successful auth

**Frontend Work**
- `src/app/auth/login/page.tsx` - Add OAuth buttons
  - "Sign in with Google"
  - "Sign in with GitHub"
  - Click → redirect to backend OAuth initiation endpoint

- `src/app/auth/register/page.tsx` - Add OAuth buttons
  - Same OAuth options for registration

- `src/app/auth/oauth-callback.tsx` - Handle OAuth callback
  - Receive code from provider
  - Send to backend (already done)
  - Wait for session
  - Redirect to dashboard

- OAuth button component (reusable)
  - `components/OauthLoginButton.tsx`

**API Changes**
```
GET    /auth/oauth/:provider              # Redirect to OAuth provider
GET    /auth/oauth/:provider/callback     # Handle callback
```

**Testing Requirements**
- ✅ Unit tests: OAuth state generation/validation
- ✅ Integration tests: OAuth flow with mock providers
- ✅ Integration tests: Just-in-time provisioning
- ✅ Integration tests: Account linking
- ✅ E2E tests: Full OAuth login flow
- ✅ Security tests: State parameter validation (CSRF protection)
- ✅ Coverage target: >80%

**Documentation Requirements**
- `docs/auth/OAUTH_SETUP.md` - Google/GitHub OAuth setup
- `docs/api/oauth-endpoints.md` - OAuth API reference
- Developer guide for adding new OAuth providers

**Security Considerations**
- ✅ State parameter for CSRF protection
- ✅ Redirect URL validation (whitelist allowed URLs)
- ✅ Never log access tokens
- ✅ Store refresh tokens encrypted
- ✅ Validate SSL certificates (HTTPS only)
- ✅ Audit log OAuth events

**Dependencies Before Start**
- OAuth credentials from Google/GitHub (configuration)
- SecretsManager for storing credentials ✅

**Blocks**
- OAuth provider configuration (external)

---

### Gap 7: Frontend Auth State Management & Session Context

**Why Required**
- Current: No global auth state; each page fetches session independently
- Results in: Race conditions, stale state, poor UX
- Needed for: Protected routes, loading states, user menu, auth-aware components

**Priority**: 🟠 HIGH (Required for all frontend auth features)

**Dependencies**
- Must complete: Authentication base ✅
- Blocks: Frontend features (all of them)

**Estimated Effort**: 1-2 weeks
- Context/hook setup: 2-3 days
- Protected route component: 1 day
- Integration with existing pages: 2-3 days
- Tests: 2 days

**Database Changes**
- None

**Backend Work**
- Update `GET /auth/session` endpoint
  - Return current user session
  - Return auth status
  - Return MFA status
  - Return CSRF token (if needed)

- Ensure token validation works ✅ (already done)

**Frontend Work**
- `src/contexts/AuthContext.tsx` - Create auth context
  ```typescript
  interface AuthContextType {
    user: User | null;
    loading: boolean;
    authenticated: boolean;
    mfaRequired: boolean;
    logout: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    refreshSession: () => Promise<void>;
  }
  ```

- `src/hooks/useAuth.ts` - Auth hook
  - Access auth context
  - Handle loading states
  - Error handling

- `src/providers/AuthProvider.tsx` - Auth provider component
  - Wraps entire app
  - Fetches session on mount
  - Refreshes session periodically (5 min)
  - Handles token expiry
  - Handles logout

- `src/components/ProtectedRoute.tsx` - Protected route wrapper
  - Redirect to login if not authenticated
  - Show loading spinner while checking auth
  - Pass user data to protected components

- Update `src/app/layout.tsx`
  - Wrap with AuthProvider
  - Use ProtectedRoute for protected pages

- Update all auth pages
  - Use useAuth hook
  - Redirect to dashboard if already logged in
  - Handle auth errors gracefully

- Create `src/components/UserMenu.tsx`
  - Display current user
  - Logout button
  - Settings link
  - Profile link

**API Changes**
- Update `GET /auth/session` response format
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "...",
        "email": "...",
        "name": "...",
        "role": "..."
      },
      "mfaRequired": false,
      "authenticated": true,
      "expiresAt": "..."
    }
  }
  ```

**Testing Requirements**
- ✅ Unit tests: Auth context behavior
- ✅ Unit tests: Auth hook
- ✅ Integration tests: Session fetching
- ✅ Integration tests: Token refresh
- ✅ E2E tests: Protected routes
- ✅ E2E tests: Logout flow
- ✅ Coverage target: >80%

**Documentation Requirements**
- `docs/development/AUTH_CONTEXT.md` - How to use auth context
- Examples in component documentation

**Security Considerations**
- ✅ Refresh token periodically (don't rely on cache indefinitely)
- ✅ Clear session on logout
- ✅ Handle expired tokens gracefully
- ✅ Don't expose sensitive data in context

**Dependencies Before Start**
- Authentication backend ✅

**Blocks**
- All frontend auth features depend on this

---

### Gap 8: API Documentation for Auth Endpoints

**Why Required**
- Endpoints currently undocumented
- Developers don't know available endpoints
- No parameter/response schema documentation
- Makes integration testing difficult

**Priority**: 🟠 HIGH (Required for development velocity)

**Dependencies**
- Must complete: All auth endpoints (in progress)
- Parallel: Can document as endpoints are built

**Estimated Effort**: 3-4 days
- Endpoint documentation: 2 days
- Example requests/responses: 1 day
- Troubleshooting guide: 1 day

**Database Changes**
- None

**Backend Work**
- No code changes; only documentation

**Frontend Work**
- No code changes; only documentation

**API Changes**
- No changes; document existing endpoints

**Documentation Required**
- `docs/api/auth-endpoints.md` - Complete reference
  - Each endpoint: path, method, description, parameters, response, errors
  - Example curl commands
  - Example success/error responses
  - Rate limiting info
  - CSRF requirements

- `docs/api/auth-examples.md` - Common flows
  - Signup flow
  - Login flow
  - Token refresh flow
  - Logout flow
  - MFA flow (when implemented)
  - OAuth flow (when implemented)

- `docs/development/AUTH_API_TESTING.md` - How to test endpoints
  - Using curl, Postman, or similar
  - Sample requests

**Testing Requirements**
- None (documentation review only)

**Security Considerations**
- ✅ Document rate limiting
- ✅ Document CSRF requirements
- ✅ Document token formats
- ✅ Document error codes

**Dependencies Before Start**
- Finalized auth endpoints

**Blocks**
- None

---

### Gap 9: Security Monitoring & Alerts

**Why Required**
- Detect account takeover attempts
- Detect brute force attacks
- Detect unusual access patterns
- Enable rapid incident response

**Priority**: 🟠 HIGH (Not critical for MVP, but important for security)

**Dependencies**
- Must complete: Audit logging (Gap 5)
- Must complete: Monitoring infrastructure (future: Phase 3)
- Parallel: Can design monitoring strategy now

**Estimated Effort**: 2-3 weeks (but much depends on monitoring infrastructure)
- Alert rules design: 2 days
- Monitoring dashboard: 3-4 days
- Alert implementations: 2-3 days
- Tests: 2 days

**Database Changes**
```sql
-- Store alert rules
CREATE TABLE "SecurityAlert" (
  id SERIAL PRIMARY KEY,
  rule_name VARCHAR(100),
  rule_description TEXT,
  threshold INTEGER, -- e.g., 5 failed attempts
  time_window_minutes INTEGER, -- e.g., 15
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Log triggered alerts
CREATE TABLE "SecurityAlertEvent" (
  id SERIAL PRIMARY KEY,
  alert_id INTEGER REFERENCES "SecurityAlert"(id),
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  ip_address INET,
  triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  alerted_admins BOOLEAN DEFAULT false,
  INDEX(user_id, triggered_at),
  INDEX(ip_address, triggered_at)
);
```

**Backend Work**
- `services/monitoring/securityAlertsService.ts` - Alert logic
  - `checkBruteForce(email)` - 5+ failed logins in 15 min
  - `checkUnusualLocation(userId, ipAddress)` - New geolocation
  - `checkRapidAccountChanges(userId)` - Multiple changes in 1 hour
  - `checkMfaBypass(userId)` - Suspicious MFA disable
  - Trigger alerts based on rules

- Alert delivery (future: Phase 3)
  - Email admins
  - Slack integration
  - SMS (future)
  - Dashboard notification

- `middleware/securityMonitoring.ts` - Monitor middleware
  - Check events as they occur
  - Trigger alerts

**Frontend Work**
- `src/pages/admin/security.tsx` - Security dashboard (future)
  - View recent security events
  - View triggered alerts
  - Configure alert rules

**API Changes**
- No new endpoints initially
- Can add monitoring endpoints in future

**Testing Requirements**
- ✅ Unit tests: Alert rule logic
- ✅ Integration tests: Alert triggering
- ✅ E2E tests: Simulated brute force → alert triggered
- ✅ Coverage target: >80%

**Documentation Requirements**
- `docs/security/SECURITY_MONITORING.md` - Alert types and thresholds
- `docs/operations/SECURITY_ALERTS.md` - How to respond to alerts
- Alert rules reference

**Security Considerations**
- ✅ Audit log alert creation
- ✅ Alert delivery is tamper-proof
- ✅ Don't expose user data in alerts
- ✅ Don't alert on false positives (whitelist trusted IPs)

**Dependencies Before Start**
- Audit logging (Gap 5) ✅ (in progress)

**Blocks**
- None (can design and stub alerts now, implement delivery later)

---

### Gap 10: Error Handling & User-Facing Messages

**Why Required**
- Current: Generic error messages ("Login failed")
- Result: Poor UX; users don't know what went wrong
- Needed: Specific, actionable error messages
- Security: Avoid information leakage

**Priority**: 🟠 HIGH (Improves UX significantly)

**Dependencies**
- Must complete: All auth endpoints (in progress)
- Parallel: Can refactor error handling now

**Estimated Effort**: 1 week
- Backend error standardization: 2 days
- Frontend error display: 2 days
- Tests: 1 day

**Database Changes**
- None

**Backend Work**
- `utils/authErrors.ts` - Standard auth error types
  ```typescript
  enum AuthErrorCode {
    INVALID_EMAIL = 'INVALID_EMAIL',
    WEAK_PASSWORD = 'WEAK_PASSWORD',
    ACCOUNT_EXISTS = 'ACCOUNT_EXISTS',
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    TOKEN_INVALID = 'TOKEN_INVALID',
    MFA_REQUIRED = 'MFA_REQUIRED',
    MFA_INVALID = 'MFA_INVALID',
    RATE_LIMITED = 'RATE_LIMITED',
    // ... etc
  }
  ```

- Update all auth routes
  - Throw specific error codes
  - Include message and status code
  - Example: `throw new BadRequestException('Invalid email format', AuthErrorCode.INVALID_EMAIL)`

- Error response format
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_EMAIL",
      "message": "The email address format is invalid",
      "details": {
        "field": "email",
        "requirement": "must be a valid email"
      }
    }
  }
  ```

**Frontend Work**
- `src/lib/errorMessages.ts` - User-friendly error messages
  - Map error codes to readable messages
  - Example: `INVALID_EMAIL` → "Please enter a valid email address"

- Update all auth forms
  - Display specific error messages
  - Show field-specific errors
  - Provide actionable guidance

- Error message component
  - `components/ErrorAlert.tsx`
  - Styled error display
  - Dismiss button

- Password strength meter feedback
  - Show specific requirements not met
  - Not just "password too weak"

**API Changes**
- Standardize all error responses
- Use consistent error code format

**Testing Requirements**
- ✅ Unit tests: Error code generation
- ✅ Integration tests: Error responses from endpoints
- ✅ E2E tests: Error display in UI
- ✅ Coverage target: >80%

**Documentation Requirements**
- `docs/api/ERROR_CODES.md` - All possible error codes and meanings
- Error handling guide for frontend developers

**Security Considerations**
- ✅ Don't expose internal system errors
- ✅ Don't reveal if email exists (account enumeration)
- ✅ Rate limit responses don't say how many attempts left (info leak)
- ✅ Log detailed errors server-side, show generic messages to user

**Dependencies Before Start**
- Auth endpoints with error handling

**Blocks**
- None

---

## MEDIUM PRIORITY GAPS

These should be completed before general availability, but not required for MVP.

---

### Gap 11: Accessibility Compliance (WCAG 2.1 AA)

**Why Required**
- Legal requirement (ADA, AODA)
- Improves UX for all users (not just people with disabilities)
- Required for enterprise contracts
- Good practice

**Priority**: 🟡 MEDIUM (MVP can launch without; GA requires it)

**Dependencies**
- Must complete: Frontend forms ✅ (in progress)
- Parallel: Can audit and fix as forms are built

**Estimated Effort**: 1-2 weeks
- Accessibility audit: 2-3 days
- Frontend fixes: 3-4 days
- Testing: 2 days

**Database Changes**
- None

**Backend Work**
- No changes

**Frontend Work**
- Add ARIA labels to all form fields
- Add semantic HTML (use `<button>`, not `<div>`)
- Add keyboard navigation (Tab, Enter, Escape)
- Add focus management (visible focus ring)
- Add screen reader support
  - Form labels properly associated
  - Error messages announced
  - Loading states announced

- Color contrast
  - Verify 4.5:1 contrast ratio on text
  - Don't rely on color alone for information

- Test with accessibility tools
  - axe DevTools
  - NVDA (screen reader)
  - Keyboard-only navigation

**API Changes**
- None

**Testing Requirements**
- ✅ Automated tests: axe accessibility audits
- ✅ Manual tests: Keyboard navigation
- ✅ Manual tests: Screen reader (NVDA)
- ✅ Visual tests: Color contrast

**Documentation Requirements**
- `docs/development/ACCESSIBILITY.md` - Guidelines for developers
- Accessibility testing guide

**Security Considerations**
- None specific to accessibility

**Dependencies Before Start**
- Frontend forms

**Blocks**
- None

---

### Gap 12: Developer Documentation

**Why Required**
- New developers can't get auth working locally
- Speeds up onboarding
- Reduces support questions

**Priority**: 🟡 MEDIUM (Nice-to-have for MVP; important for team scaling)

**Dependencies**
- Must complete: Auth implementation
- Parallel: Can write docs as features are built

**Estimated Effort**: 3-4 days
- Local setup guide: 1 day
- Troubleshooting guide: 1 day
- Example code walkthroughs: 1 day
- Video tutorials: 1 day (optional)

**Documentation Required**
- `docs/development/AUTH_SETUP_LOCAL.md`
  - Step-by-step setup
  - Database initialization
  - Environment variables
  - Common issues and solutions

- `docs/development/AUTH_DEVELOPMENT.md`
  - How to modify auth code
  - Where to add new endpoints
  - Testing auth locally
  - Debugging tips

- `docs/development/AUTH_TESTING_GUIDE.md`
  - Running test suite
  - Writing new auth tests
  - Test fixtures
  - Mocking OAuth

- `docs/development/OAUTH_SETUP_LOCAL.md`
  - Create Google OAuth app
  - Create GitHub OAuth app
  - Get credentials
  - Configure in `.env.local`

**Testing Requirements**
- None (documentation review)

**Security Considerations**
- ✅ Warn about not using test credentials in production

**Dependencies Before Start**
- Finalized auth system

**Blocks**
- None

---

### Gap 13: User-Facing Documentation

**Why Required**
- Users need help with signup/login/password reset
- Reduce support tickets
- Professional appearance

**Priority**: 🟡 MEDIUM (Nice-to-have for MVP; important for GA)

**Dependencies**
- Must complete: Auth UI
- Parallel: Can write docs as features are built

**Estimated Effort**: 2-3 days
- User guide: 1 day
- FAQ: 1 day
- Video tutorials: 1 day (optional)

**Documentation Required**
- `docs/user/GETTING_STARTED.md`
  - Create account
  - Sign in
  - Profile setup
  - Password reset

- `docs/user/FAQ.md`
  - Forgot password?
  - Account locked?
  - Can't sign in?
  - How to enable 2FA? (when available)
  - How to sign in with Google?

- `docs/user/ACCOUNT_SECURITY.md`
  - Password best practices
  - Why use strong passwords?
  - Why use MFA?
  - How to change password

**Testing Requirements**
- None

**Security Considerations**
- ✅ Explain security features
- ✅ Encourage strong passwords and MFA

**Dependencies Before Start**
- Finalized auth UI

**Blocks**
- None

---

### Gap 14: Mock Auth for Local Development

**Why Required**
- Developers can work on features without running database
- Speeds up feature development
- Enables offline work

**Priority**: 🟡 MEDIUM (Nice-to-have for MVP)

**Dependencies**
- Must complete: Dev runtime system ✅
- Parallel: Can implement after MFA/password reset

**Estimated Effort**: 1 week
- Mock auth provider: 2-3 days
- Mock session storage: 1 day
- Integration with dev runtime: 1-2 days
- Tests: 1 day

**Database Changes**
- None

**Backend Work**
- `services/devRuntime/mockAuthProvider.ts`
  - Mock login (always succeeds with test credentials)
  - Mock signup (always succeeds)
  - Mock token generation
  - Mock session management (in-memory)
  - Mock MFA (skip MFA requirement)

- `config/dev.ts` - Dev mode configuration
  - Enable mock auth mode
  - Skip database requirement
  - Use in-memory session store

- Middleware to bypass auth in dev mode
  - If dev mode: assume authenticated
  - Generate fake user context
  - Skip MFA requirements

**Frontend Work**
- Auto-fill demo credentials
- Quick-login button (development only)
- Skip MFA in dev mode

**API Changes**
- None; existing endpoints work with mocks

**Testing Requirements**
- ✅ Unit tests: Mock auth behavior
- ✅ Integration tests: Mock flow

**Documentation Requirements**
- `docs/development/MOCK_AUTH.md`
  - How to enable mock auth
  - Demo credentials
  - Limitations

**Security Considerations**
- ✅ Mock auth ONLY enabled in development mode
- ✅ Configuration prevents accidental production use

**Dependencies Before Start**
- Dev runtime system ✅

**Blocks**
- None

---

### Gap 15: Performance Monitoring & Metrics

**Why Required**
- Detect slow auth performance
- Monitor for DoS attacks
- Track auth success rates
- Capacity planning

**Priority**: 🟡 MEDIUM (Nice-to-have for MVP; important for scale)

**Dependencies**
- Must complete: Audit logging ✅ (in progress)
- Parallel: Can add metrics collection now

**Estimated Effort**: 1 week
- Backend metrics collection: 2-3 days
- Monitoring dashboard: 2-3 days
- Tests: 1 day

**Database Changes**
```sql
-- Store metrics
CREATE TABLE "AuthMetrics" (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(100),
  metric_value DECIMAL(15, 2),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tags JSONB, -- {endpoint: '/auth/login', status: 'success'}
  INDEX(metric_name, recorded_at)
);
```

**Backend Work**
- `middleware/metricsCollection.ts` - Collect performance metrics
  - Login latency
  - Token generation latency
  - Database query time
  - API response time
  - Error rates

- `services/monitoring/metricsService.ts`
  - Record metrics to database
  - Calculate aggregates (average, P95, P99)
  - Export to monitoring system

**Frontend Work**
- `src/pages/admin/metrics.tsx` - Metrics dashboard (future)
  - Auth success rate
  - Login latency graph
  - Error rate graph

**API Changes**
- No new endpoints initially

**Testing Requirements**
- ✅ Unit tests: Metrics recording
- ✅ Integration tests: Metrics collection in auth flows

**Documentation Requirements**
- `docs/operations/AUTH_METRICS.md` - Metrics reference
- Dashboard guide

**Security Considerations**
- ✅ Don't log sensitive details (user IDs are OK, emails are not)

**Dependencies Before Start**
- Audit logging framework ✅ (in progress)

**Blocks**
- None (can start collecting metrics now, visualize later)

---

## IMPLEMENTATION SEQUENCE

Based on dependencies and impact, here's the recommended implementation order:

### Phase A: Critical Security (Weeks 1-4)

**Week 1: CSRF Protection**
- Setup CSRF infrastructure
- Implement CSRF middleware
- Update login/register forms
- Dependencies: None
- Blocks: MFA work

**Week 2: MFA/2FA (Part 1 - Backend)**
- Design MFA database schema
- Implement TOTP generation/verification
- Implement backup codes
- Implement MFA routes
- Dependencies: CSRF Protection (for MFA endpoints)

**Week 3: MFA/2FA (Part 2 - Frontend)**
- Build MFA setup page
- Build MFA verification page
- Integrate with login flow
- Dependencies: Backend MFA ✅

**Week 4: Audit Logging & Tests**
- Implement comprehensive audit logging
- Write unit tests for auth (password, JWT, tokens)
- Write integration tests (signup, login, logout)
- Dependencies: MFA ✅

### Phase B: User Experience (Weeks 5-7)

**Week 5: Password Reset**
- Design password reset database schema
- Implement password reset backend
- Build password reset UI
- Email integration (stub initially)
- Dependencies: CSRF Protection ✅

**Week 6: Frontend Auth State & Session Management**
- Create auth context and hooks
- Build protected route component
- Integrate with existing pages
- Dependencies: Password reset ✅

**Week 7: Error Handling & OAuth**
- Standardize error codes
- Update all auth endpoints for proper errors
- Implement OAuth backend (Google, GitHub)
- Build OAuth UI
- Dependencies: Frontend state management ✅

### Phase C: Documentation & Polish (Weeks 8-10)

**Week 8: Comprehensive Testing**
- Write E2E tests
- Performance tests
- Security tests (SQL injection, XSS, timing attacks)
- Coverage >85%
- Dependencies: All features ✅

**Week 9: Documentation**
- API documentation
- Developer setup guide
- User guides and FAQ
- Dependencies: All features ✅

**Week 10: Accessibility & Monitoring**
- Accessibility audit and fixes (WCAG 2.1 AA)
- Implement security monitoring/alerts
- Performance metrics
- Dependencies: All features ✅

### Critical Path (Do these first)
1. CSRF Protection (Week 1) - Foundation for all other auth changes
2. MFA (Weeks 2-3) - Security critical
3. Password Reset (Week 5) - UX critical
4. Frontend State Management (Week 6) - Blocks all frontend work
5. Comprehensive Tests (Week 8) - Required before production

### Parallel Work (Can run in parallel)
- Audit logging (Week 4) - Can start Week 1 in parallel with CSRF
- OAuth (Week 7) - Can start Week 2 in parallel with MFA backend
- Error handling (Week 7) - Can start Week 3 in parallel with frontend MFA

---

## Effort Summary

| Gap | Priority | Effort | Critical Path |
|-----|----------|--------|---|
| CSRF | Critical | 1-2w | ✅ Week 1 |
| MFA | Critical | 3-4w | ✅ Weeks 2-3 |
| Password Reset | Critical | 2-3w | ✅ Week 5 |
| Comprehensive Tests | Critical | 2-3w | ✅ Week 8 |
| Audit Logging | Critical | 1w | Week 4 |
| Frontend State Management | High | 1-2w | ✅ Week 6 |
| OAuth | High | 2-3w | Week 7 |
| API Documentation | High | 3-4d | Week 9 |
| Error Handling | High | 1w | Week 7 |
| Monitoring & Alerts | High | 2-3w | Week 10 |
| Accessibility | Medium | 1-2w | Week 10 |
| Developer Docs | Medium | 3-4d | Week 9 |
| User Docs | Medium | 2-3d | Week 9 |
| Mock Auth | Medium | 1w | Week 10 |
| Performance Metrics | Medium | 1w | Week 10 |

**Total Effort**: 8-10 weeks for full team (1 backend + 1 frontend + 1 QA)

---

## Risk & Mitigation

### High Risk Items
1. **MFA Complexity** - TOTP + backup codes + recovery → Mitigate: Start early, extensive testing
2. **Password Reset Email** - Requires async jobs → Mitigate: Stub with console.log initially, implement real email in Phase 2
3. **OAuth Integration** - Depends on provider cooperation → Mitigate: Use well-tested libraries (passport.js alternatives)
4. **Comprehensive Tests** - High effort → Mitigate: Parallelize with implementation

### Low Risk Items
- CSRF protection (well-established pattern)
- Audit logging (infrastructure mostly done)
- Documentation (no technical risk)

---

## Success Criteria

Module 1 is complete when:

✅ All 15 layers are ≥90% complete  
✅ Test coverage >85%  
✅ All security requirements met (OWASP top 10)  
✅ All API endpoints documented  
✅ All features tested (E2E)  
✅ Accessibility WCAG 2.1 AA compliant  
✅ All documentation complete  
✅ Performance baselines established  
✅ Security monitoring active  
✅ Zero critical security findings  

---

**Document Status**: Ready for implementation planning  
**Next Step**: User approval of sequence and effort estimates  
**Owner**: Engineering leadership  
**Last Updated**: 2026-07-21
