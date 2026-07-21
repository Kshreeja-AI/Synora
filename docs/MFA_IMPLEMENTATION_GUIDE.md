# Multi-Factor Authentication (MFA) - Implementation Guide

## Overview

This guide documents the complete MFA implementation for Synora AI Platform, including architecture, API endpoints, frontend integration, and deployment instructions.

## System Architecture

### Components

1. **TOTP Service** (`services/mfa/totp.service.ts`)
   - RFC 6238 compliant Time-based One-Time Passwords
   - 30-second time windows, 6-digit codes
   - SHA-1 HMAC, counter-based

2. **Recovery Code Service** (`services/mfa/recovery-code.service.ts`)
   - Generates backup codes in XXXX-XXXX format
   - ~42 bits entropy per code
   - Timing-safe verification, one-time use enforcement

3. **Token Services**
   - **Setup Token** (`setup-token.service.ts`): 10-minute tokens for secure enrollment
   - **Challenge Token** (`challenge-token.service.ts`): 5-minute tokens for MFA verification

4. **MFA Service** (`services/mfa/mfa.service.ts`)
   - Orchestrates all components
   - Manages flow: setup → verify → confirm → challenge
   - Handles lockout and rate limiting

5. **Database Schema** (Prisma models)
   - `MFAMethod`: User's active MFA configuration
   - `MFASetupToken`: Temporary tokens during enrollment
   - `MFAChallengeToken`: Temporary tokens during login
   - `MFARecoveryCode`: Recovery code records with usage tracking
   - `MFAAttempt`: Audit trail of verification attempts

### Flow Diagrams

#### Setup Flow
```
User clicks "Enable MFA"
  ↓
POST /auth/mfa/setup/initiate → Generate secret + QR code
  ↓
User scans QR code in authenticator app
  ↓
User enters 6-digit code
  ↓
POST /auth/mfa/setup/verify → Verify code, return recovery codes
  ↓
User downloads/saves recovery codes
  ↓
POST /auth/mfa/setup/confirm → Create MFAMethod in database
  ↓
MFA enabled ✓
```

#### Login MFA Flow
```
User enters email + password
  ↓
Password verification succeeds
  ↓
Check if MFA enabled
  ↓
Generate MFA challenge token
  ↓
Return 403 with mfaChallengeToken
  ↓
Frontend shows MFA verification form
  ↓
User enters 6-digit code from authenticator (or recovery code)
  ↓
POST /auth/mfa/verify → Verify code/recovery code
  ↓
If valid: return JWT token + session
  ↓
Login complete ✓
```

#### Recovery Flow
```
User lost device with authenticator app
  ↓
At login MFA screen, click "I don't have access"
  ↓
User enters recovery code instead of 6-digit code
  ↓
POST /auth/mfa/verify with recoveryCode → Verify code
  ↓
Mark recovery code as used
  ↓
Set MFA status to RECOVERY_MODE (warning: re-enable MFA soon)
  ↓
Login proceeds with JWT
  ↓
User should re-enable MFA with new device
```

## API Endpoints

### GET /auth/mfa/status
**Description**: Get user's current MFA status

**Authentication**: Required (user must be logged in)

**Response**:
```json
{
  "data": {
    "mfaEnabled": boolean,
    "type": "TOTP" | null,
    "status": "ACTIVE" | "RECOVERY_MODE" | "DISABLED" | null,
    "enabledAt": ISO8601 date | null,
    "lastUsedAt": ISO8601 date | null,
    "recoveryCodesRemaining": number,
    "recoveryCodesTotal": number
  }
}
```

### POST /auth/mfa/setup/initiate
**Description**: Start MFA setup process, generate QR code

**Authentication**: Required

**Request**: Empty body

**Response**:
```json
{
  "data": {
    "setupToken": "string (64 hex chars)",
    "secret": "string (32 Base32 chars)",
    "qrCode": "string (otpauth:// URI)",
    "expiresAt": ISO8601 date
  }
}
```

**Error Responses**:
- `409 Conflict`: MFA already enabled for user

### POST /auth/mfa/setup/verify
**Description**: Verify TOTP code during setup, return recovery codes

**Authentication**: Required

**Request**:
```json
{
  "setupToken": "string",
  "code": "string (6 digits)"
}
```

**Response**:
```json
{
  "data": {
    "recoveryCodes": ["XXXX-XXXX", ...],
    "setupToken": "string",
    "nextStep": "confirm"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid code format
- `401 Unauthorized`: Invalid or expired setup token
- `401 Unauthorized`: Invalid verification code

### POST /auth/mfa/setup/confirm
**Description**: Confirm MFA setup completion, create MFAMethod in database

**Authentication**: Required

**Request**:
```json
{
  "setupToken": "string",
  "recoveryCodes": ["XXXX-XXXX", ...],
  "recoveryCodesSaved": true
}
```

**Response**:
```json
{
  "data": {
    "message": "MFA setup complete",
    "mfaEnabled": true
  }
}
```

**Error Responses**:
- `401 Unauthorized`: Recovery codes not saved (recoveryCodesSaved must be true)
- `401 Unauthorized`: Missing recovery codes
- `401 Unauthorized`: Invalid setup token

### POST /auth/mfa/verify
**Description**: Verify MFA code during login (no auth required, uses challenge token)

**Authentication**: Not required (uses challenge token instead)

**Request** (TOTP code):
```json
{
  "mfaChallengeToken": "string",
  "code": "string (6 digits)"
}
```

**Request** (Recovery code):
```json
{
  "mfaChallengeToken": "string",
  "recoveryCode": "XXXX-XXXX"
}
```

**Response**:
```json
{
  "data": {
    "message": "MFA verified",
    "mfaVerified": true,
    "warning": "Recovery code used. You have 48 hours to re-enable MFA..."
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid code format
- `401 Unauthorized`: Invalid challenge token or code
- `401 Unauthorized`: Too many failed attempts (account locked out)
- `401 Unauthorized`: Recovery code already used or invalid

### GET /auth/mfa/recovery-codes
**Description**: List user's recovery codes (masked)

**Authentication**: Required

**Response**:
```json
{
  "data": {
    "codes": [
      {
        "prefix": "AAAA****",
        "usedAt": ISO8601 date | null
      },
      ...
    ]
  }
}
```

### POST /auth/mfa/disable
**Description**: Disable MFA (requires password confirmation)

**Authentication**: Required

**Request**:
```json
{
  "password": "string"
}
```

**Response**:
```json
{
  "data": {
    "message": "MFA disabled",
    "mfaEnabled": false
  }
}
```

**Error Responses**:
- `400 Bad Request`: Missing password
- `401 Unauthorized`: Invalid password

## Frontend Integration

### Components

#### MFASetupDialog
Complete setup flow UI with QR code display, code verification, and recovery codes.

```tsx
import { MFASetupDialog } from '@/components/MFASetupDialog';

export function SettingsPage() {
  const [showSetup, setShowSetup] = useState(false);

  return (
    <>
      <button onClick={() => setShowSetup(true)}>
        Enable MFA
      </button>
      <MFASetupDialog
        isOpen={showSetup}
        onClose={() => setShowSetup(false)}
        onComplete={() => {
          // Refresh user settings
        }}
      />
    </>
  );
}
```

#### MFAVerificationForm
Login MFA verification form with code + recovery code fallback.

```tsx
import { MFAVerificationForm } from '@/components/MFAVerificationForm';

// In login page after password verification
<MFAVerificationForm
  mfaChallengeToken={challengeToken}
  email={userEmail}
/>
```

#### MFAManagementPanel
Full management interface for existing MFA settings.

```tsx
import { MFAManagementPanel } from '@/components/MFAManagementPanel';

export function SecuritySettings() {
  return <MFAManagementPanel />;
}
```

#### MFAStatusIndicator
Simple status display component.

```tsx
import { MFAStatusIndicator } from '@/components/MFAStatusIndicator';

// Compact version (in header/nav)
<MFAStatusIndicator compact />

// Full version (in settings)
<MFAStatusIndicator />
```

### Hooks

#### useMFASetup
Frontend state management for MFA setup flow.

```tsx
const mfa = useMFASetup();

// Trigger each step
await mfa.initiate();
await mfa.verifyCode('123456');
await mfa.confirm();

// Access state
console.log(mfa.step); // 'idle' | 'initiating' | 'qr-ready' | ...
console.log(mfa.setupToken);
console.log(mfa.secret);
console.log(mfa.qrCode);
console.log(mfa.recoveryCodes);
console.log(mfa.error);
console.log(mfa.isLoading);

// Reset
mfa.reset();
```

## Database Schema

### MFAMethod
```prisma
model MFAMethod {
  id              String   @id @default(cuid())
  userId          String
  type            MFAType  @default(TOTP)
  status          MFAStatus @default(SETUP_PENDING)
  secret          String   // TOTP secret (Base32)
  backupCodesHash String[] // Array of SHA-256 hashes
  deviceName      String?
  createdAt       DateTime @default(now())
  enabledAt       DateTime?
  lastUsedAt      DateTime?

  user           User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  attempts       MFAAttempt[]
  recoveryCodes  MFARecoveryCode[]

  @@unique([userId, type])
  @@index([status])
  @@index([enabledAt])
}

enum MFAType {
  TOTP
}

enum MFAStatus {
  SETUP_PENDING
  ACTIVE
  DISABLED
  RECOVERY_MODE
}
```

### MFASetupToken
```prisma
model MFASetupToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique // SHA-256(token)
  secret    String   // TOTP secret during setup
  verified  Boolean  @default(false)
  createdAt DateTime @default(now())
  expiresAt DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}
```

### MFAChallengeToken
```prisma
model MFAChallengeToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique // SHA-256(token)
  sessionId String
  ipAddress String
  userAgent String
  createdAt DateTime @default(now())
  expiresAt DateTime
  usedAt    DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tokenHash])
  @@index([userId])
  @@index([expiresAt])
  @@index([userId, createdAt])
}
```

### MFARecoveryCode
```prisma
model MFARecoveryCode {
  id        String   @id @default(cuid())
  mfaMethodId String
  codeHash  String   @unique // SHA-256(code)
  createdAt DateTime @default(now())
  usedAt    DateTime?

  mfaMethod MFAMethod @relation(fields: [mfaMethodId], references: [id], onDelete: Cascade)

  @@index([mfaMethodId])
  @@index([usedAt])
  @@index([mfaMethodId, createdAt])
}
```

### MFAAttempt
```prisma
model MFAAttempt {
  id        String   @id @default(cuid())
  mfaMethodId String
  sessionId String?
  ipAddress String?
  userAgent String?
  code      String   // Last 4 digits only
  success   Boolean
  createdAt DateTime @default(now())

  mfaMethod MFAMethod @relation(fields: [mfaMethodId], references: [id], onDelete: Cascade)

  @@index([mfaMethodId])
  @@index([createdAt])
  @@index([success])
  @@index([mfaMethodId, createdAt, success])
}
```

## Security Properties

### Token Security
- **No Token Persistence**: Raw tokens never stored in database, only SHA-256 hashes
- **Timing-Safe Comparison**: All verification uses `crypto.timingSafeEqual` to prevent timing attacks
- **Token Entropy**: 32 bytes (256 bits) random bytes for all tokens
- **Token Expiry**: Enforced at verification time
- **Session Binding**: Tokens include sessionId, ipAddress, userAgent for context

### TOTP Security
- **RFC 6238 Compliant**: Standard TOTP implementation
- **HMAC-SHA1**: Industry standard for TOTP (per RFC)
- **30-Second Windows**: ±1 window acceptance (current, previous, next)
- **6-Digit Codes**: 1 million possible codes, 30-second validity
- **No Reuse Prevention**: By design, new code every 30 seconds

### Recovery Codes
- **42-Bit Entropy**: 8-char alphanumeric codes
- **One-Time Use**: Each code can only be used once, then marked used
- **Format Validation**: XXXX-XXXX format enforced
- **Timing-Safe Verification**: Prevents timing attacks on recovery codes
- **10 Codes Per User**: Provides 10 recovery attempts

### Account Protection
- **Brute Force Lockout**: 5 failed attempts → 15-minute lockout
- **Attempt Logging**: All attempts logged with last 4 digits of code
- **Per-IP Rate Limiting**: Token generation limited to 10/minute per IP
- **Session Invalidation**: Challenge tokens consumed after use

### Data Protection
- **Secrets Stored Hashed**: TOTP secrets stored (needed for verification)
- **Recovery Codes Hashed**: Only SHA-256 hashes stored
- **Audit Trail**: MFAAttempt table tracks all verification attempts
- **Cascade Delete**: User deletion cascades to all MFA records

## Threat Model & Mitigations

| Threat | Mitigation |
|--------|-----------|
| Brute force on TOTP code | 5 failed attempts → 15-min lockout |
| Timing attack on token validation | Timing-safe comparison (crypto.timingSafeEqual) |
| Token theft from database | Only hashes stored, raw tokens returned to client immediately |
| Replay attack on challenge token | Token consumed after verification (marked usedAt) |
| Recovery code brute force | Timing-safe verification, one-time use |
| QR code interception | QR code is public (contains no secret), secret sent separately |
| Secret compromise | User can disable and re-enable MFA with new secret |
| Lost device recovery | 10 recovery codes per user for access without device |

## Configuration

### Constants (in mfa.service.ts)
```typescript
export const MFA_CONFIG = {
  MAX_FAILED_ATTEMPTS: 5,           // Failed attempts before lockout
  LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
  ATTEMPT_RATE_LIMIT: 10,           // Tokens per 10 minutes per IP
};
```

### TOTP Constants (in totp.service.ts)
```typescript
TOTP_WINDOW: 30,    // seconds (RFC 6238 standard)
TOTP_DIGITS: 6,     // 6-digit codes
TOTP_ALGORITHM: 'sha1',
TOTP_DRIFT: 1,      // Accept current ± 1 window
```

### Token Expiry
- Setup Token: 10 minutes
- Challenge Token: 5 minutes
- Recovery Codes: No expiry

## Testing

### Test Coverage
- **TOTP Service**: Format validation, code generation, verification, entropy
- **Recovery Code Service**: Generation, hashing, timing-safe verification
- **Challenge Token Service**: Generation, expiry, consumption, cleanup
- **Setup Token Service**: Secret handling, verification, cleanup
- **MFA Service**: Full flows, lockout, recovery codes, attempt logging
- **API Routes**: Endpoint validation, error handling, auth checks
- **Frontend Hook**: State management, error handling, flow integration
- **Frontend Components**: Rendering, user interaction, API integration

### Running Tests
```bash
# All tests
npm run test

# MFA tests only
npm run test -- mfa

# Watch mode
npm run test:watch -- mfa

# Coverage
npm run test:coverage -- mfa
```

### Key Test Scenarios
1. Complete setup flow: initiate → verify → confirm
2. Complete login MFA: password → challenge → verify code
3. Recovery code flow: lost device → use recovery code
4. Lockout enforcement: 5 failed attempts → blocked
5. Token cleanup: expired tokens marked/deleted
6. Recovery code reuse prevention
7. Timing-safe verification
8. Race condition prevention (atomic transactions)

## Deployment

### Prerequisites
- PostgreSQL with Prisma ORM
- Node.js 20+
- qrcode React library (or use qrcode.react)

### Environment Variables
```env
# Backend
NODE_ENV=production
JWT_SECRET=<secure-random-string>
DATABASE_URL=postgresql://...

# Frontend
NEXT_PUBLIC_API_URL=https://api.example.com
```

### Database Migration
```bash
# Generate migration
npx prisma migrate dev --name add_mfa

# Apply in production
npx prisma migrate deploy
```

### Post-Deployment
1. Test MFA setup flow end-to-end
2. Test MFA login flow
3. Verify recovery code functionality
4. Monitor MFA attempt logs
5. Test lockout mechanism

## Monitoring & Logging

### Logs to Monitor
- MFA setup attempts (success/failure)
- MFA verification attempts (success/failure)
- Account lockouts (5+ failed attempts)
- Recovery code usage
- MFA disabling

### Metrics to Track
- MFA adoption rate (% of users with MFA enabled)
- MFA success rate (% of login attempts with MFA successful)
- Lockout rate (% of users locked out)
- Recovery code usage rate
- Average time-to-setup

### Alerting
- Unusual spike in failed MFA attempts
- High rate of account lockouts
- Rapid recovery code consumption (possible attack)

## Troubleshooting

### User Cannot Verify Setup Code
- Check authenticator app is synced to system time
- Try code from ±1 window (previous/current/next)
- Verify QR code scanned correctly
- Restart authenticator app

### User Locked Out of Account
- Wait 15 minutes for lockout to expire
- Or provide recovery code
- Or use account recovery flow

### Recovery Codes Exhausted
- User must re-enable MFA with new device
- Previous recovery codes no longer usable
- Provides 10 new codes

### TOTP Secret Lost
- User cannot recover without recovery codes
- Must use account recovery process
- Re-enable MFA with new device/secret

## References

- [RFC 6238: TOTP](https://tools.ietf.org/html/rfc6238)
- [RFC 4648: Base32 Encoding](https://tools.ietf.org/html/rfc4648)
- [OWASP: Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Google Authenticator Documentation](https://support.google.com/accounts/answer/1066447)
