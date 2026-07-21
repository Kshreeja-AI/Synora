# Multi-Factor Authentication (MFA) Design

**Status**: DESIGN PHASE  
**Target**: Production-Grade Implementation  
**Scope**: TOTP, Recovery Codes, Device Verification, Session Binding

---

## Architecture Overview

### MFA Flow Diagrams

#### 1. Setup Flow (Enable MFA)
```
1. User clicks "Enable 2FA"
   → GET /auth/mfa/setup/initiate
   ← Returns: setupToken (short-lived, 10 min), secret

2. User scans QR code with authenticator app
   → Frontend displays: Secret + QR code

3. User enters 6-digit code from authenticator
   → POST /auth/mfa/setup/verify
   ← Returns: Recovery codes (user saves these)
   ← MFA is now ENABLED on account

4. User confirms recovery codes saved
   → POST /auth/mfa/setup/confirm
   ← MFA fully activated
```

#### 2. Login Flow (With MFA)
```
1. User enters email + password
   → POST /auth/login
   ← Backend: Password verified ✓
   ← User has MFA enabled
   ← Returns: mfaChallengeToken (short-lived, 5 min)
   ← Client redirected to MFA verification page

2. User enters 6-digit code from authenticator
   → POST /auth/mfa/verify
   ← Headers: mfaChallengeToken
   ← Backend: Code verified ✓
   ← Returns: JWT token + session
   ← Client redirected to dashboard
```

#### 3. Recovery Flow (Lost Authenticator)
```
1. User can't access authenticator
   → POST /auth/mfa/recovery
   ← Returns: Recovery codes required

2. User enters email + recovery code
   → POST /auth/mfa/recovery/verify
   ← Recovery code consumed (single-use)
   ← Session established
   ← User guided to disable MFA + re-enable with new device

3. User disables old MFA
   → POST /auth/mfa/disable
   ← Requires password confirmation
   ← New recovery codes generated
   ← Can now setup new authenticator
```

### Data Model

#### MFA Methods Table
```prisma
model MFAMethod {
  id              String    @id @default(cuid())
  userId          String
  type            MFAType   // TOTP, etc.
  status          MFAStatus // ACTIVE, DISABLED, RECOVERY
  
  // TOTP-specific
  secret          String?   // Base32-encoded shared secret (encrypted)
  backupCodesHash String[]  // Hashed recovery codes
  
  // Metadata
  deviceName      String?   // "iPhone", "Pixel", etc.
  createdAt       DateTime  @default(now())
  enabledAt       DateTime?
  lastUsedAt      DateTime?
  
  // Relations
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  attempts        MFAAttempt[]
  
  @@unique([userId, type])  // Only one TOTP per user
  @@index([userId])
  @@index([status])
}

model MFAAttempt {
  id              String    @id @default(cuid())
  mfaMethodId     String
  sessionId       String?
  ipAddress       String?
  userAgent       String?
  code            String    // Last 4 digits only (log partial code)
  success         Boolean
  createdAt       DateTime  @default(now())
  
  mfaMethod       MFAMethod @relation(fields: [mfaMethodId], references: [id], onDelete: Cascade)
  
  @@index([mfaMethodId])
  @@index([createdAt])
  @@index([success])
}

model MFAChallengeToken {
  id              String    @id @default(cuid())
  userId          String
  token           String    @unique // Hash stored, like CSRF tokens
  sessionId       String?
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime  @default(now())
  expiresAt       DateTime  // 5 minutes
  usedAt          DateTime?
  
  @@index([token])
  @@index([userId])
  @@index([expiresAt])
}

model MFARecoveryCode {
  id              String    @id @default(cuid())
  mfaMethodId     String
  codeHash        String    @unique // Hashed recovery code
  usedAt          DateTime?
  createdAt       DateTime  @default(now())
  
  mfaMethod       MFAMethod @relation("RecoveryCodes", fields: [mfaMethodId], references: [id], onDelete: Cascade)
  
  @@index([mfaMethodId])
  @@index([usedAt])
}

model MFASetupToken {
  id              String    @id @default(cuid())
  userId          String
  token           String    @unique // Hash stored
  secret          String    // Temp TOTP secret (encrypted)
  verified        Boolean   @default(false)
  createdAt       DateTime  @default(now())
  expiresAt       DateTime  // 10 minutes
  
  @@index([token])
  @@index([userId])
}

enum MFAType {
  TOTP            // Time-based One-Time Password
}

enum MFAStatus {
  SETUP_PENDING   // In setup process
  ACTIVE          // Enabled and in use
  DISABLED        // User disabled
  RECOVERY_MODE   // Using recovery codes only (lost device)
}
```

### Constants & Config

```typescript
export const MFA_CONFIG = {
  // TOTP Configuration (RFC 6238)
  TOTP_WINDOW: 30,              // 30-second time window
  TOTP_DIGITS: 6,               // 6-digit codes
  TOTP_ALGORITHM: 'SHA1',       // Standard algorithm
  TOTP_ISSUER: 'Synora AI',     // Shown in authenticator apps
  
  // Time windows (seconds)
  CHALLENGE_TOKEN_EXPIRY: 5 * 60,           // 5 minutes
  SETUP_TOKEN_EXPIRY: 10 * 60,              // 10 minutes
  RECOVERY_MODE_DURATION: 48 * 60 * 60,    // 48 hours
  
  // Attempt tracking
  MAX_FAILED_ATTEMPTS: 5,                   // Lock after 5 failed attempts
  LOCKOUT_DURATION: 15 * 60,                // 15 minutes
  ATTEMPT_RATE_LIMIT: 10,                  // Max 10 attempts per 10 minutes
  
  // Recovery codes
  RECOVERY_CODE_COUNT: 10,                  // Generate 10 codes
  RECOVERY_CODE_LENGTH: 8,                  // 8-character codes
  RECOVERY_CODE_FORMAT: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/, // XXXX-XXXX format
  
  // Secret encryption
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  SECRET_ENCODING: 'base32',               // RFC 4648
};
```

### API Endpoints

#### Setup Phase
```http
# 1. Initiate setup (requires authentication)
GET /auth/mfa/setup/initiate
Authorization: Bearer {jwt}

Response 200
{
  "success": true,
  "data": {
    "setupToken": "setup_token_hash",
    "secret": "JBSWY3DPEBLW64TMMQ...",  // Base32 secret
    "qrCode": "data:image/png;base64,...",
    "expiresAt": "2026-07-21T10:10:00Z"
  }
}

# 2. Verify code + save recovery codes
POST /auth/mfa/setup/verify
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "setupToken": "setup_token_hash",
  "code": "123456"
}

Response 200
{
  "success": true,
  "data": {
    "recoveryCodes": [
      "ABC1-DEF2",
      "GHI3-JKL4",
      ...
    ],
    "nextStep": "confirm"
  }
}

# 3. Confirm setup complete
POST /auth/mfa/setup/confirm
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "setupToken": "setup_token_hash",
  "recoveryCodesSaved": true
}

Response 200
{
  "success": true,
  "data": {
    "message": "MFA enabled successfully"
  }
}
```

#### Verification Phase (Login)
```http
# 1. Login with password (first factor)
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response 200 (MFA Required)
{
  "success": false,
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication required"
  },
  "data": {
    "mfaChallengeToken": "challenge_token_hash",
    "expiresAt": "2026-07-21T10:05:00Z"
  }
}

# 2. Submit MFA code
POST /auth/mfa/verify
Content-Type: application/json

{
  "mfaChallengeToken": "challenge_token_hash",
  "code": "123456"  // From authenticator app
}

Response 200
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "user-123",
      "email": "user@example.com",
      "mfaEnabled": true
    }
  }
}

# Alternative: Use recovery code
POST /auth/mfa/verify
Content-Type: application/json

{
  "mfaChallengeToken": "challenge_token_hash",
  "recoveryCode": "ABC1-DEF2"
}

Response 200
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "recoveryModeWarning": "You used a recovery code. Please re-enable MFA with new device."
  }
}
```

#### Management Phase
```http
# Get MFA status
GET /auth/mfa/status
Authorization: Bearer {jwt}

Response 200
{
  "success": true,
  "data": {
    "mfaEnabled": true,
    "type": "TOTP",
    "status": "ACTIVE",
    "enabledAt": "2026-06-01T00:00:00Z",
    "lastUsedAt": "2026-07-21T09:00:00Z",
    "recoveryCodesRemaining": 8
  }
}

# Disable MFA
POST /auth/mfa/disable
Authorization: Bearer {jwt}
Content-Type: application/json

{
  "password": "password123"  // Require password confirmation
}

Response 200
{
  "success": true,
  "data": {
    "message": "MFA disabled"
  }
}

# List recovery codes (admin/user)
GET /auth/mfa/recovery-codes
Authorization: Bearer {jwt}

Response 200
{
  "success": true,
  "data": {
    "codes": [
      { "code": "ABC1-****", "usedAt": null },
      { "code": "DEF2-****", "usedAt": "2026-07-20T10:00:00Z" },
      ...
    ]
  }
}
```

#### Recovery Phase
```http
# Request recovery (no auth required)
POST /auth/mfa/recovery/request
Content-Type: application/json

{
  "email": "user@example.com"
}

Response 200
{
  "success": true,
  "data": {
    "message": "Recovery code required"
  }
}

# Verify recovery code
POST /auth/mfa/recovery/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "recoveryCode": "ABC1-DEF2"
}

Response 200
{
  "success": true,
  "data": {
    "token": "recovery_jwt_token",
    "message": "Recovery successful. You have 48 hours to re-enable MFA with new device."
  }
}

# Disable old MFA + re-setup (with recovery token)
POST /auth/mfa/setup/initiate
Authorization: Bearer {recovery_token}

Response 200
{
  "success": true,
  "data": {
    "setupToken": "setup_token",
    "secret": "JBSWY3DPEBLW64TMMQ...",
    "qrCode": "..."
  }
}
```

---

## Security Properties

### Authentication Factors
1. **Knowledge**: Password (login)
2. **Possession**: Authenticator app (TOTP code)
3. **Fallback**: Recovery codes (possession-based)

### Attack Mitigations

| Attack | Mitigation | Implementation |
|--------|-----------|-----------------|
| Brute Force | Rate limiting + lockout | 5 failed attempts → 15 min lockout |
| Code Reuse | Time-window validation | Only current/previous window accepted |
| Code Prediction | HMAC-SHA1 + counter | RFC 6238 standard |
| Recovery Code Theft | Hashed storage | Only hash in DB, plaintext in setup email |
| Phishing | Authenticator tie-in | Code bound to TOTP secret, not transferable |
| Session Hijacking | Challenge token binding | Token tied to session + IP + user agent |
| Timing Attacks | Constant-time comparison | crypto.timingSafeEqual |
| Lost Device | Recovery codes | 10 one-time backup codes per setup |

### Cryptographic Properties
- **TOTP**: RFC 6238 compliant (SHA1-based HMAC-OTP)
- **Secret**: 160-bit entropy (20 bytes, Base32 encoded)
- **Challenge Token**: Same as CSRF (256-bit entropy, SHA-256 hash)
- **Recovery Codes**: 8 chars (5.3 bits/char × 8 = 42 bits entropy per code)
- **Secret Storage**: AES-256-GCM encrypted at rest
- **Code Comparison**: Timing-safe comparison (constant-time)

---

## Database Schema

### New Tables Required
1. `MFAMethod` - User's MFA configuration
2. `MFAAttempt` - Login attempt audit trail
3. `MFAChallengeToken` - Short-lived tokens for verification
4. `MFARecoveryCode` - One-time backup codes
5. `MFASetupToken` - Temporary tokens during setup

### Indexes Required
```sql
CREATE INDEX idx_mfa_method_user_id ON "MFAMethod"("userId");
CREATE INDEX idx_mfa_method_status ON "MFAMethod"("status");
CREATE INDEX idx_mfa_attempt_method_id ON "MFAAttempt"("mfaMethodId");
CREATE INDEX idx_mfa_attempt_created ON "MFAAttempt"("createdAt");
CREATE INDEX idx_mfa_challenge_user_id ON "MFAChallengeToken"("userId");
CREATE INDEX idx_mfa_challenge_expires ON "MFAChallengeToken"("expiresAt");
CREATE INDEX idx_mfa_recovery_method_id ON "MFARecoveryCode"("mfaMethodId");
CREATE INDEX idx_mfa_recovery_used ON "MFARecoveryCode"("usedAt");
```

---

## Frontend Architecture

### Components
1. **MFASetupDialog**
   - Shows QR code
   - Collects verification code
   - Displays recovery codes

2. **MFAVerificationPage**
   - Code input form
   - Recovery code fallback
   - Attempt counter + lockout messaging

3. **MFAManagementPanel**
   - Enable/disable toggle
   - Recovery code list + download
   - Re-setup option

4. **MFAStatusIndicator**
   - Shows MFA enabled/disabled status
   - Last used timestamp
   - Recovery codes remaining

### State Management
```typescript
interface MFAState {
  enabled: boolean;
  type: 'TOTP' | null;
  challengeToken: string | null;
  attempts: number;
  isLocked: boolean;
  lockoutEndTime: Date | null;
}
```

---

## Implementation Phases

### Phase 1: Backend Core (Days 1-2)
- [x] Design database schema
- [ ] Database migration
- [ ] TOTP service (generation + verification)
- [ ] Recovery code service
- [ ] Challenge token service
- [ ] MFA routes (setup + verify + disable)

### Phase 2: Authentication Integration (Days 2-3)
- [ ] Login flow with MFA check
- [ ] Challenge token validation
- [ ] Session creation after MFA
- [ ] Logout with MFA cleanup

### Phase 3: Frontend (Days 3-4)
- [ ] Setup flow UI
- [ ] Verification flow UI
- [ ] Management UI
- [ ] Error handling + recovery flows

### Phase 4: Testing & Documentation (Days 4-5)
- [ ] Unit tests (TOTP, recovery codes, tokens)
- [ ] Integration tests (full flows)
- [ ] Security tests (brute force, timing attacks)
- [ ] Documentation (API, security, deployment)

---

## Success Criteria

- ✅ TOTP generation + verification (RFC 6238)
- ✅ Recovery codes (10 codes, one-time use)
- ✅ QR code for easy authenticator enrollment
- ✅ Rate limiting (10 attempts / 10 minutes)
- ✅ Account lockout (5 failed attempts → 15 min)
- ✅ Session binding (challenge token → JWT)
- ✅ Audit logging (all attempts + recovery code usage)
- ✅ Frontend flows (setup + verify + manage)
- ✅ Complete API endpoints
- ✅ Test coverage >85%
- ✅ Security review pass (0 critical issues)
- ✅ Documentation complete

---

**Next Step**: Database schema design + migration
