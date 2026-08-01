# MFA Security Audit - Complete Findings

## Executive Summary
The MFA implementation contains **9 critical/high severity security vulnerabilities** that prevent production deployment. One is a **complete authentication bypass**, multiple enable timing attacks, and several create race conditions.

## CRITICAL Issues (Must Fix Before Production)

### Issue #1: Counter Buffer Calculation Bug in TOTP
**Severity**: CRITICAL  
**File**: `apps/backend/src/services/mfa/totp.service.ts`, lines 117-135  
**Root Cause**: Counter buffer is incorrectly encoded - only lowest byte repeated 8 times instead of proper big-endian 64-bit

```typescript
// BUGGY CODE (lines 117-135)
private static getCounter(timestamp: number): Buffer {
  const counter = Math.floor(timestamp / this.TIME_STEP);
  const buffer = Buffer.alloc(8);
  
  for (let i = 0; i < 8; i++) {
    buffer[i] = counter & 0xff;  // WRONG: repeats lowest byte
  }
  
  return buffer;
}
```

**Impact**: Generated TOTP codes are INCORRECT and don't match RFC 6238 standard. Codes generated are non-functional.

**Fix**: Implement proper big-endian 64-bit encoding
```typescript
private static getCounter(timestamp: number): Buffer {
  const counter = Math.floor(timestamp / this.TIME_STEP);
  const buffer = Buffer.alloc(8);
  
  // Proper big-endian 64-bit encoding
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    counter >>>= 8;
  }
  
  return buffer;
}
```

**Test**: Add RFC 6238 test vector validation

---

### Issue #2: Timing Oracle in timingSafeEqual
**Severity**: HIGH  
**File**: `apps/backend/src/services/mfa/totp.service.ts`, lines 140-150  
**Root Cause**: Length check before constant-time comparison leaks information

```typescript
// BUGGY CODE
if (computedCode.length !== code.length) {
  return false;  // Returns immediately - timing leak!
}

return crypto.timingSafeEqual(Buffer.from(computedCode), Buffer.from(code));
```

**Impact**: Attacker can determine code length through timing analysis before even attempting the constant-time comparison.

**Fix**: Pad both to same length before comparison
```typescript
const bufComputed = Buffer.from(computedCode.padStart(6, '0'));
const bufProvided = Buffer.from(code.padStart(6, '0'));
return crypto.timingSafeEqual(bufComputed, bufProvided);
```

---

### Issue #3: Recovery Code Canonicalization Bug
**Severity**: MEDIUM  
**File**: `apps/backend/src/services/mfa/recovery-code.service.ts`  
**Root Cause**: hashCode() doesn't uppercase input, but validator does

```typescript
// generateCode uses UPPERCASE: "ABCD-EFGH"
// But hashCode(code) doesn't uppercase: 
hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
  // If code is lowercase "abcd-efgh", hash is different from generated
}
```

**Impact**: Recovery codes generated in uppercase don't verify when user enters lowercase. One-time use enforcement fails.

**Fix**:
```typescript
hashCode(code: string): string {
  return crypto.createHash('sha256')
    .update(code.toUpperCase())  // Canonicalize
    .digest('hex');
}
```

---

### Issue #4: Recovery Code Reuse Race Condition (TOCTOU)
**Severity**: CRITICAL  
**File**: `apps/backend/src/services/mfa/mfa.service.ts`, lines 315-338  
**Root Cause**: Check-then-act pattern without atomic transaction

```typescript
// BUGGY CODE
const recoveryCodeRecord = await prisma.mFARecoveryCode.findFirst({
  where: { mfaMethodId: mfaMethod.id, codeHash }
});

if (!recoveryCodeRecord || recoveryCodeRecord.usedAt) {
  throw new Error('Invalid recovery code');  // Check
}

// Between check and act, another request could use the same code!
await prisma.mFARecoveryCode.update({
  where: { id: recoveryCodeRecord.id },
  data: { usedAt: new Date() },  // Act
});
```

**Impact**: Two concurrent requests can both pass the "not used" check and both mark the code as used. Code can be reused.

**Fix**: Atomic conditional update
```typescript
const updated = await prisma.mFARecoveryCode.updateMany({
  where: {
    id: recoveryCodeRecord.id,
    usedAt: null  // Only update if NOT used
  },
  data: { usedAt: new Date() }
});

if (updated.count === 0) {
  throw new Error('Code already used or invalid');
}
```

---

### Issue #5: Timing Analysis on Recovery Code Verification
**Severity**: CRITICAL  
**File**: `apps/backend/src/services/mfa/mfa.service.ts`, lines 315-338  
**Root Cause**: Linear search through recovery codes reveals which codes exist

```typescript
// BUGGY CODE
const recoveryCodeRecord = await prisma.mFARecoveryCode.findFirst({
  where: { mfaMethodId: mfaMethod.id, codeHash }  // Single lookup, not constant-time
});
```

**Impact**: Attacker can determine which recovery codes exist (or don't exist) by timing the findFirst() call. Database response time leaks information.

**Fix**: Use constant-time search
```typescript
// Get ALL codes for the MFA method
const allRecoveryCodes = await prisma.mFARecoveryCode.findMany({
  where: { mfaMethodId: mfaMethod.id }
});

// Search in constant-time manner
let foundCode: typeof allRecoveryCodes[0] | null = null;
for (const code of allRecoveryCodes) {
  if (crypto.timingSafeEqual(Buffer.from(code.codeHash), Buffer.from(codeHash))) {
    foundCode = code;
  }
}
```

---

### Issue #6: Lockout Off-by-One Error
**Severity**: HIGH  
**File**: `apps/backend/src/services/mfa/mfa.service.ts`, lines 244-262  
**Root Cause**: Locks AFTER 5th failed attempt completes instead of BEFORE

```typescript
// BUGGY CODE
const failedAttempts = await prisma.mFAAttempt.count({
  where: {
    mfaMethodId: mfaMethod.id,
    success: false,
    createdAt: { gt: lockoutStart }
  }
});

if (failedAttempts >= 5) {  // Allows 5 attempts
  // Record the 5th failed attempt FIRST
  await recordAttempt(false);
  throw new Error('Account locked');
}
```

**Impact**: Allows 5 failed attempts instead of intended 4. Should check BEFORE recording the attempt.

**Fix**: Check before recording
```typescript
if (failedAttempts >= MFA_CONFIG.MAX_FAILED_ATTEMPTS - 1) {
  throw new Error('Account locked');
}
await recordAttempt(false);
```

---

### Issue #7: Mock Challenge Token Parser - Complete Authentication Bypass
**Severity**: CRITICAL - AUTHENTICATION BYPASS  
**File**: `apps/backend/src/routes/mfa.ts`, lines 225-227  
**Root Cause**: Challenge token parser is a stub returning hardcoded user ID for ANY token

```typescript
// CRITICAL BUG: Stub function that breaks ALL MFA verification!
const parseChallengeToken = (token: string) => 'temp-user-id';  // HARDCODED!

// Usage in POST /auth/mfa/verify:
const userId = parseChallengeToken(mfaChallengeToken);  // Always returns 'temp-user-id'!
```

**Impact**: **COMPLETE AUTHENTICATION BYPASS** - Any attacker can verify as 'temp-user-id' without providing valid credentials. MFA verification endpoint is non-functional.

**Fix**: Use ChallengeTokenService
```typescript
const challengeToken = await ChallengeTokenService.verifyToken(
  mfaChallengeToken,
  userId  // From session/JWT
);

if (!challengeToken) {
  return res.status(401).json({ error: { message: 'Invalid or expired token' } });
}

// Then verify MFA code
const mfaMethod = await mfa.verifyChallengeCode(userId, code, recoveryCode);

// Consume token atomically
await ChallengeTokenService.consumeToken(challengeToken.id);
```

---

### Issue #8: Missing Password Verification on MFA Disable
**Severity**: HIGH  
**File**: `apps/backend/src/routes/mfa.ts`, lines 188-191  
**Root Cause**: Password validation is commented out

```typescript
// BUGGY CODE
const body = req.body;
// const isPasswordValid = await bcrypt.compare(body.password, user.passwordHash);
// if (!isPasswordValid) {
//   return res.status(401).json({ error: { message: 'Invalid password' } });
// }
// MFA disabled without password verification!
await mfa.disable(userId);
```

**Impact**: Attacker with session hijack can disable MFA without password. Defense bypass.

**Fix**: Uncomment and implement password verification
```typescript
const user = await prisma.user.findUnique({ where: { id: userId } });
if (!user) {
  return res.status(401).json({ error: { message: 'User not found' } });
}

const isPasswordValid = await bcrypt.compare(body.password, user.passwordHash);
if (!isPasswordValid) {
  return res.status(401).json({ error: { message: 'Invalid password' } });
}

await mfa.disable(userId);
```

---

### Issue #9: Recovery Codes Not Validated on Setup Confirm
**Severity**: HIGH  
**File**: `apps/backend/src/routes/mfa.ts`, lines 112-118  
**Root Cause**: Recovery codes taken directly from request body without validation

```typescript
// BUGGY CODE
const body = req.body;
// Should validate that recovery codes are proper SHA-256 hashes
await mfa.confirmSetup(userId, body.setupToken, body.recoveryCodes);
```

**Impact**: Client can submit any value as recovery codes (empty array, wrong format, etc.). Backend stores without validation.

**Fix**: Validate format before accepting
```typescript
// Recovery codes should be SHA-256 hashes: 64 hex characters each
const recoveryCodesFromUser = Array.isArray(body.recoveryCodes) ? body.recoveryCodes : [];

// Validate each code is a valid SHA-256 hash (64 hex chars)
for (const code of recoveryCodesFromUser) {
  if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
    return res.status(400).json({ 
      error: { message: 'Invalid recovery code format' } 
    });
  }
}

await mfa.confirmSetup(userId, body.setupToken, recoveryCodesFromUser);
```

---

### Issue #10: Recovery Codes Stored in Frontend State
**Severity**: MEDIUM  
**File**: `apps/web/src/hooks/useMFASetup.ts`, lines 8-10  
**Root Cause**: Sensitive recovery codes stored in React state

```typescript
recoveryCodes: string[] | null;  // Stored in memory, exposed to DevTools
```

**Impact**: Recovery codes visible in React DevTools, browser memory, error logs if component crashes.

**Fix**: Clear immediately after confirmation, don't persist in state
```typescript
// After user confirms saving codes, clear from state
setState(prev => ({ ...prev, recoveryCodes: null }));
```

---

### Issue #11: Setup Token and Secret in Frontend State
**Severity**: MEDIUM  
**File**: `apps/web/src/hooks/useMFASetup.ts`, lines 7-9  
**Root Cause**: Setup token and secret stored in React state

**Impact**: Sensitive tokens visible in DevTools, memory dumps.

**Fix**: Use httpOnly cookies via backend instead

---

### Issue #12: Timing Attack in Challenge Token Service
**Severity**: MEDIUM  
**File**: `apps/backend/src/services/mfa/challenge-token.service.ts`, line 66  
**Root Cause**: userId comparison not timing-safe

```typescript
if (!challengeToken || challengeToken.userId !== userId) {
  return null;  // Returns immediately if userId mismatch
}
```

**Fix**: Use constant-time comparison
```typescript
if (!challengeToken) {
  return null;
}

// Timing-safe userId comparison
const userIdBuffer = Buffer.from(challengeToken.userId);
const providedIdBuffer = Buffer.from(userId);
try {
  crypto.timingSafeEqual(userIdBuffer, providedIdBuffer);
} catch {
  return null;  // Length mismatch or comparison failed
}
```

---

### Issue #13: Timing Attack in Setup Token Service
**Severity**: MEDIUM  
**File**: `apps/backend/src/services/mfa/setup-token.service.ts`, lines 58, 96  
**Root Cause**: userId and verified comparisons not timing-safe

**Fix**: Use constant-time comparison for userId

---

### Issue #14: Recovery Code Format Validation Incomplete
**Severity**: LOW  
**File**: `apps/web/src/components/MFAVerificationForm.tsx`, line 124  
**Root Cause**: Recovery code accepts "AAAA-----" or other malformed inputs

```typescript
// Accepts input like "AAAA-----" which has no digits in 2nd half
onChange={(e) => setRecoveryCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
```

**Fix**: Validate format is exactly XXXX-XXXX
```typescript
const input = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatted = input.slice(0, 4) + (input.length > 4 ? '-' + input.slice(4, 8) : '');
setRecoveryCode(formatted);
```

---

### Issue #15: RFC 6238 Test Vectors Missing
**Severity**: HIGH (Quality)  
**File**: `apps/backend/src/services/mfa/__tests__/totp.test.ts`  
**Root Cause**: Tests don't validate against RFC 6238 test vectors

**Impact**: Counter buffer bug and other TOTP implementation errors aren't caught by tests.

**Fix**: Add RFC 6238 validation tests with known vectors

---

## Summary Table

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Counter buffer bug | CRITICAL | Need Fix |
| 2 | Timing oracle in timingSafeEqual | HIGH | Need Fix |
| 3 | Recovery code canonicalization | MEDIUM | Need Fix |
| 4 | Recovery code reuse TOCTOU | CRITICAL | Need Fix |
| 5 | Timing analysis on recovery codes | CRITICAL | Need Fix |
| 6 | Lockout off-by-one | HIGH | Need Fix |
| 7 | Mock token parser (AUTH BYPASS) | CRITICAL | Need Fix |
| 8 | Missing password verification | HIGH | Need Fix |
| 9 | Recovery codes not validated | HIGH | Need Fix |
| 10 | Recovery codes in state | MEDIUM | Need Fix |
| 11 | Setup token in state | MEDIUM | Need Fix |
| 12 | Challenge token timing attack | MEDIUM | Need Fix |
| 13 | Setup token timing attack | MEDIUM | Need Fix |
| 14 | Recovery code format validation | LOW | Need Fix |
| 15 | Missing RFC 6238 test vectors | HIGH (QA) | Need Fix |

## Conclusion

**The implementation is NOT PRODUCTION READY.**

With 4 CRITICAL vulnerabilities including a complete authentication bypass, the MFA system cannot be deployed in its current state. All issues must be fixed and re-tested before production use.
