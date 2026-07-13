# Synora AI - Security & Compliance Guide

## Security Overview

Security is built into every layer of Synora AI, from authentication to data protection.

## Authentication & Authorization

### JWT Implementation

**Token Structure**
```
{
  "userId": "user_id",
  "email": "user@example.com",
  "role": "USER",
  "iat": 1673616000,
  "exp": 1673616900
}
```

**Token Lifecycle**
- Access token: 15 minutes
- Refresh token: 7 days
- Session: HTTP-only, Secure, SameSite=Strict

### Password Security

```typescript
// Password hashing with bcryptjs
const hashedPassword = await bcryptjs.hash(password, 12);

// Password validation
const isValid = await bcryptjs.compare(inputPassword, hashedPassword);
```

**Password Requirements**
- Minimum 8 characters
- Must contain uppercase letter
- Must contain lowercase letter
- Must contain number
- Must contain special character

### Session Management

```typescript
// Session timeout
const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days

// Session invalidation on logout
await prisma.session.delete({ where: { sessionToken } });
```

## API Security

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// Standard API rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later'
});

// Stricter limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true // only count failed requests
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);
```

### CORS Configuration

```typescript
app.use(
  cors({
    origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
```

### CSRF Protection

```typescript
// For state-changing requests, require CSRF token
import csrf from 'csurf';

const csrfProtection = csrf({ cookie: false });

app.post('/api/sensitive-action', csrfProtection, (req, res) => {
  // Handle request
});
```

### Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.yourdomain.com'],
      fontSrc: ["'self'", 'https://fonts.googleapis.com'],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
```

## Data Protection

### Encryption at Rest

```typescript
// For sensitive fields, encrypt before storing
import crypto from 'crypto';

const encryptField = (plaintext: string): string => {
  const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY!);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const decryptField = (encrypted: string): string => {
  const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY!);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
```

### SQL Injection Prevention

```typescript
// Using Prisma - parameterized queries (safe by default)
const user = await prisma.user.findUnique({
  where: { email: userInput } // Safe - no string interpolation
});

// ❌ NOT SAFE - Don't do this:
// const user = await prisma.$queryRaw`SELECT * FROM "User" WHERE email = ${userInput}`;
```

### XSS Prevention

```typescript
// Validate and sanitize all user inputs
import DOMPurify from 'isomorphic-dompurify';

const sanitizedContent = DOMPurify.sanitize(userProvidedHTML);
```

### Input Validation

```typescript
import { z } from 'zod';

const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().max(1000000), // 1MB max
  format: z.enum(['MARKDOWN', 'HTML', 'PLAIN_TEXT']),
  projectId: z.string().cuid().optional()
});

// Validate at route handler
const validated = createDocumentSchema.parse(req.body);
```

## API Security Best Practices

### API Key Management

```typescript
// Generate API keys
const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Verify API key (hash stored in DB)
const verifyApiKey = async (key: string): Promise<boolean> => {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const record = await prisma.apiKey.findUnique({ where: { key: hash } });
  return !!record;
};
```

### Rate Limiting by API Key

```typescript
const apiKeyLimiter = rateLimit({
  keyGenerator: (req) => req.headers['x-api-key'] as string,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10000 // 10k requests per hour
});
```

## Authentication Best Practices

### MFA (Multi-Factor Authentication)

```typescript
// Generate TOTP secret
import speakeasy from 'speakeasy';

const secret = speakeasy.generateSecret({
  name: `Synora (${email})`,
  issuer: 'Synora'
});

// Verify TOTP code
const verified = speakeasy.totp.verify({
  secret: secret.base32,
  encoding: 'base32',
  token: userProvidedToken,
  window: 2
});
```

### OAuth2 Implementation

```typescript
// NextAuth.js configuration
export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Validate user data
      return true;
    },
    async session({ session, token }) {
      // Add custom fields to session
      session.user.role = token.role;
      return session;
    }
  }
};
```

## Logging & Monitoring

### Sensitive Data Logging

```typescript
// Never log sensitive data
// ❌ WRONG
logger.info('User login:', { email, password }); // DO NOT DO THIS

// ✅ CORRECT
logger.info('User login:', { email, userId });

// Redact sensitive fields
const redactedUser = {
  ...user,
  password: '***',
  apiKey: '***'
};
```

### Audit Logging

```typescript
// Log all sensitive actions
const logActivity = async (userId: string, action: string, resource: string) => {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      resource,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    }
  });
};

// Usage
await logActivity(userId, 'UPDATE_PASSWORD', 'USER');
await logActivity(userId, 'DELETE_DOCUMENT', `document_${docId}`);
```

## Dependency Security

### Vulnerability Scanning

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# Use Snyk for continuous monitoring
npm install -g snyk
snyk test
snyk monitor
```

### Dependency Updates

```bash
# Update dependencies regularly
npm outdated
npm update

# Use npm-check-updates for major versions
npm install -g npm-check-updates
ncu -u
```

## Environment Variable Security

```bash
# ✅ CORRECT - Use environment variables
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
API_KEY=your-api-key

# ❌ WRONG - Never hardcode secrets
const JWT_SECRET = "hardcoded_secret";
```

### .env File Security

```bash
# Add to .gitignore
echo ".env.local" >> .gitignore
echo ".env.*.local" >> .gitignore

# Use strong permissions
chmod 600 .env.local

# Never commit .env files
git rm --cached .env.local
```

## GDPR & Privacy Compliance

### Data Retention

```typescript
// Delete user data after 30 days of account deletion
const deleteOldUsers = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  await prisma.user.deleteMany({
    where: {
      status: 'DELETED',
      updatedAt: { lt: thirtyDaysAgo }
    }
  });
};
```

### Data Export

```typescript
// Allow users to export their data
export const exportUserData = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      documents: true,
      images: true,
      videos: true
    }
  });

  return JSON.stringify(user);
};
```

### Right to be Forgotten

```typescript
// Anonymize instead of delete
export const anonymizeUser = async (userId: string) => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: `deleted-${userId}@deleted.local`,
      name: 'Deleted User',
      status: 'DELETED',
      password: null
    }
  });
};
```

## Security Checklist

### Pre-Production
- [ ] All secrets in environment variables
- [ ] HTTPS enabled
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (using parameterized queries)
- [ ] XSS prevention (sanitize outputs)
- [ ] CSRF protection for state-changing requests
- [ ] Security headers configured
- [ ] API keys hashed and salted
- [ ] Passwords hashed with bcryptjs
- [ ] Error messages don't leak sensitive info
- [ ] Logging doesn't log sensitive data
- [ ] Database backups configured
- [ ] WAF (Web Application Firewall) enabled
- [ ] SSL/TLS certificate valid
- [ ] Dependencies scanned for vulnerabilities

### Production Monitoring
- [ ] Error tracking (Sentry)
- [ ] Performance monitoring
- [ ] Security headers verified
- [ ] Rate limiting monitored
- [ ] Failed login attempts tracked
- [ ] Unusual API activity alerted
- [ ] Daily security log reviews
- [ ] Weekly penetration testing

## Security Contact

For security issues, please email: security@synora.ai

**Do not** open public GitHub issues for security vulnerabilities.

---

**Last Updated**: 2026-01-13
