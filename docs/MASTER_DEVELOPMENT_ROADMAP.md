# Synora AI Platform - Master Development Roadmap

**Status**: Planning Phase  
**Last Updated**: 2026-07-21  
**Owner**: Synora Engineering Team

---

## Executive Summary

This document defines the complete module structure for Synora, broken into independent, sequentially-implementable components. Each module stands alone with clear dependencies, allowing parallel teams to work on separate modules while maintaining system coherence.

**Total Modules**: 15  
**Implementation Phases**: 4  
**Estimated Timeline**: Q3 2026 - Q2 2027

---

## Module Dependency Graph

```
Phase 1 (Foundation) → Phase 2 (Content) → Phase 3 (Collaboration) → Phase 4 (Enterprise)

Foundation:
- Auth System (core)
- Provider Layer (core)
- Secrets Mgmt (core)
- Config Management (core)

↓

Content Creation:
- Document Mgmt (depends on Foundation)
- Image Generation (depends on Provider Layer)
- Video Generation (depends on Provider Layer)
- Audio Generation (depends on Provider Layer)
- Writing Assistant (depends on Provider Layer)
- Code Assistant (depends on Provider Layer)

↓

Collaboration:
- Team Management (depends on Auth, Document Mgmt)
- Workspace Management (depends on Auth, Document Mgmt)
- Permissions & Roles (depends on Auth, Team Mgmt)
- Real-time Collaboration (depends on Workspace, Permissions)

↓

Enterprise:
- SSO/SAML (depends on Auth)
- Advanced Compliance (depends on Secrets, All features)
- Custom Model Training (depends on Provider Layer)
- Analytics Dashboard (depends on All features)
```

---

## Phase 1: Foundation Layer (Completed/In Progress)

These modules form the base infrastructure that all other modules depend on.

### Module 1.1: Authentication & Authorization

**Status**: ✅ Completed (Milestone 1)  
**Complexity**: Medium  
**Owner**: Backend Team

#### Purpose
Secure user authentication using JWT + NextAuth.js v5, with support for OAuth2 providers (Google, GitHub) and session management. Provides the foundation for user identity across the entire platform.

#### Architecture
- **NextAuth.js v5** for OAuth2 flow orchestration
- **JWT tokens** for stateless API authentication (15-min access, 7-day refresh)
- **Session middleware** for request-level user context
- **Password hashing** with bcryptjs (12 rounds)
- **Rate limiting** on auth endpoints (5 attempts/15 min)

#### Dependencies
- PostgreSQL (session/user storage)
- Environment configuration
- Secrets management (for JWT_SECRET, OAuth credentials)

#### Database Schema
```sql
-- Users table
CREATE TABLE "User" (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  email_verified TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table
CREATE TABLE "Session" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  expires TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OAuth Accounts table
CREATE TABLE "Account" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'oauth'
  provider VARCHAR(50) NOT NULL, -- 'google', 'github'
  provider_account_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at BIGINT,
  UNIQUE(provider, provider_account_id)
);

-- Audit Log
CREATE TABLE "AuditLog" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(100),
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
POST   /auth/signup              # Register new user
POST   /auth/login               # Login with email/password
POST   /auth/logout              # Logout and invalidate session
POST   /auth/refresh             # Refresh access token
GET    /auth/session             # Get current session
GET    /auth/oauth/google        # Initiate Google OAuth
GET    /auth/oauth/callback      # OAuth callback handler
POST   /auth/password/reset      # Request password reset
POST   /auth/password/reset/:token # Confirm password reset
POST   /auth/mfa/enable          # Enable 2FA
POST   /auth/mfa/verify          # Verify 2FA code
```

#### Frontend
- Login/signup forms (email, password, OAuth buttons)
- Session context provider (React)
- Protected routes wrapper
- MFA setup wizard
- Password reset flow

#### Backend
- `middleware/auth.ts` - JWT verification
- `middleware/errorHandler.ts` - Error standardization
- `routes/auth.ts` - Auth endpoints
- `services/userService.ts` - User CRUD operations
- `utils/password.ts` - Password hashing/validation
- `utils/jwt.ts` - JWT creation/validation

#### Security Requirements
- ✅ Passwords hashed with bcryptjs (12+ rounds)
- ✅ JWT tokens signed and verified
- ✅ Refresh tokens stored server-side, invalidated on logout
- ✅ Rate limiting on auth endpoints (brute-force protection)
- ✅ CORS restricted to allowed origins
- ✅ Secure HTTP-only cookies for sessions
- ✅ CSRF tokens for state-changing operations
- ✅ Audit logging for all auth events
- ✅ No sensitive data in logs

#### Testing
- ✅ Unit tests: password hashing, JWT validation
- ✅ Integration tests: signup/login/logout flows
- ✅ E2E tests: complete auth journey with OAuth
- ✅ Security tests: rate limiting, CSRF protection
- ✅ Coverage target: >85%

#### Documentation
- `docs/auth/AUTHENTICATION.md` - Auth architecture & flows
- `docs/auth/OAUTH_SETUP.md` - Google/GitHub OAuth setup
- `docs/auth/MFA_SETUP.md` - Multi-factor authentication
- `docs/api/auth-endpoints.md` - API reference

#### Deployment
- Environment variables: `JWT_SECRET`, `NEXTAUTH_SECRET`, OAuth credentials
- Secrets rotation enabled for JWT_SECRET
- Database backups automated (hourly, retain 30 days)
- Audit logs persisted to PostgreSQL
- No hardcoded secrets in any environment

#### Future Extensibility
- [ ] SAML 2.0 support (enterprise SSO)
- [ ] Hardware security key support (FIDO2)
- [ ] Passwordless auth (WebAuthn)
- [ ] Account recovery codes
- [ ] Advanced session analytics

---

### Module 1.2: Provider Abstraction Layer

**Status**: ✅ Completed (Stabilization Session - Branch 4)  
**Complexity**: High  
**Owner**: Architecture Team

#### Purpose
Unified interface over 21 AI/ML capabilities (text generation, image generation, video generation, etc.), allowing the platform to work with any provider (OpenAI, Anthropic, Hugging Face, Replicate, custom on-premises models) without core code changes.

#### Architecture
- **ICapabilityProvider interface** - Common contract for all capabilities
- **CapabilityRegistry** - Capability discovery and metadata
- **CapabilityResolver** - Priority-based auto-selection of providers
- **Provider implementations** - Concrete adapters for each provider
- **Mock providers** - For development, testing, offline use
- **Error standardization** - Unified error handling across providers

#### Capabilities (21 total)
1. Text Generation (chat, completion)
2. Text-to-Image (Dall-E, Midjourney, Stable Diffusion)
3. Image-to-Text (OCR, image description)
4. Text-to-Video (video generation)
5. Speech-to-Text (transcription)
6. Text-to-Speech (voiceover generation)
7. Speech-to-Speech (voice cloning)
8. Code Generation (code completion, debugging)
9. Code Execution (sandboxed code running)
10. Embeddings (semantic search, vector similarity)
11. Fine-tuning (model adaptation)
12. Audio Generation (music, sound effects)
13. Moderation (content safety checking)
14. Translation (multi-language)
15. Summarization (content abstraction)
16. Sentiment Analysis
17. Named Entity Recognition
18. Machine Translation
19. Document Understanding (PDF/image parsing)
20. 3D Generation (object/scene modeling)
21. Game AI (NPC behavior, procedural generation)

#### Dependencies
- Secrets Management (for provider API keys)
- Environment Configuration (for provider selection)
- Local Dev Runtime (for mock providers)
- Logging (for capability invocation tracking)

#### Database Schema
```sql
-- Provider Configuration
CREATE TABLE "Provider" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', 'huggingface', etc.
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100,
  config JSONB, -- rate limits, model overrides, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Capability Mappings
CREATE TABLE "CapabilityMapping" (
  id SERIAL PRIMARY KEY,
  capability VARCHAR(100) NOT NULL,
  provider_id INTEGER REFERENCES "Provider"(id) ON DELETE CASCADE,
  model_id VARCHAR(255),
  is_available BOOLEAN DEFAULT true,
  cost_per_unit DECIMAL(10, 6),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(capability, provider_id)
);

-- Invocation Logs
CREATE TABLE "CapabilityInvocationLog" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  capability VARCHAR(100) NOT NULL,
  provider_id INTEGER REFERENCES "Provider"(id),
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  status VARCHAR(20), -- 'success', 'error', 'timeout'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(capability, created_at)
);
```

#### APIs (REST)
```
GET    /capabilities                        # List all available capabilities
GET    /capabilities/:name                  # Get capability details
GET    /capabilities/:name/providers        # List providers for capability
GET    /providers                           # List all configured providers
GET    /providers/:id/capabilities          # List capabilities for provider
POST   /providers/:id/test                  # Test provider connectivity
POST   /invokers/:capability                # Invoke a capability
GET    /invokers/logs                       # Get invocation logs
```

#### Frontend
- Capability browser (admin panel)
- Provider configuration UI
- Cost analytics by capability
- Invocation logs & debugging tools

#### Backend
- `services/capabilities/ICapabilityProvider.ts` - Interface definition
- `services/capabilities/CapabilityRegistry.ts` - Registry
- `services/capabilities/CapabilityResolver.ts` - Auto-selection logic
- `services/providers/*/provider.ts` - Provider implementations
- `services/providers/mock/mockProviders.ts` - Mock implementations
- `middleware/capabilityInvoker.ts` - Request interceptor
- `routes/capabilities.ts` - API endpoints

#### Security Requirements
- ✅ API keys encrypted at rest
- ✅ API keys never logged or visible in responses
- ✅ Rate limiting per provider
- ✅ Cost tracking to prevent runaway spending
- ✅ Provider-specific auth validated at startup
- ✅ Fallback to mock providers if real provider fails
- ✅ Audit logging for all capability invocations
- ✅ Data residency compliance (providers mapped to regions)

#### Testing
- ✅ Unit tests: CapabilityRegistry, CapabilityResolver
- ✅ Unit tests: Each provider implementation (with mocks)
- ✅ Integration tests: Multi-provider capability selection
- ✅ Integration tests: Provider failover & fallback
- ✅ E2E tests: End-to-end capability invocation with real/mock providers
- ✅ Performance tests: Latency per capability per provider
- ✅ Coverage target: >85%

#### Documentation
- `docs/architecture/PROVIDER_LAYER.md` - Architecture overview
- `docs/capabilities/CAPABILITY_REFERENCE.md` - All 21 capabilities
- `docs/providers/PROVIDER_SETUP.md` - How to add new providers
- `docs/providers/[PROVIDER_NAME].md` - Provider-specific setup (OpenAI, Anthropic, etc.)
- `docs/api/capability-endpoints.md` - API reference

#### Deployment
- Environment variables: Provider API keys, rate limits
- Secrets rotation: API key rotation per provider
- Health checks: Provider connectivity test at startup
- Fallback strategy: Defined per capability (fail → mock)
- Cost budgets: Enforced per provider per day
- Regional routing: Route to provider by data residency rules

#### Future Extensibility
- [ ] On-premises model hosting (Ollama, vLLM)
- [ ] Custom provider plugins (community-contributed)
- [ ] Multi-step workflows (chain capabilities together)
- [ ] Capability caching (memoize results for identical inputs)
- [ ] A/B testing framework (compare providers)
- [ ] Synthetic data generation (for testing)

---

### Module 1.3: Secrets Management

**Status**: ✅ Completed (Stabilization Session - Branch 2)  
**Complexity**: Medium  
**Owner**: Security Team

#### Purpose
Centralized secret management with versioning, rotation grace periods, audit logging, and hardware security module (HSM) integration for production. Replaces scattered `process.env` reads with a unified, type-safe API.

#### Architecture
- **SecretsManager orchestrator** - Primary API
- **Secret sources** - Environment variables, Docker, Kubernetes, HSM
- **Versioning system** - Keep old versions during rotation grace period
- **Audit logging** - Log access, rotation, rotation attempts (no values logged)
- **Type safety** - Zod schemas ensure only declared secrets are accessible
- **Placeholder fallback** - Non-strict stages use generated placeholders

#### Secret Catalog
```
JWT_SECRET              # Token signing key
DATABASE_PASSWORD       # PostgreSQL password
NEXTAUTH_SECRET         # NextAuth session encryption
OAUTH_GOOGLE_SECRET     # Google OAuth client secret
OAUTH_GITHUB_SECRET     # GitHub OAuth client secret
PROVIDER_API_KEY_OPENAI # OpenAI API key
PROVIDER_API_KEY_*      # [other provider keys]
S3_SECRET_KEY           # AWS S3 secret key
ENCRYPTION_KEY          # Data encryption key
WEBHOOK_SECRET          # Webhook HMAC secret
```

#### Dependencies
- Environment Configuration (for secret source selection)
- Logging (for audit trails)
- Database (for audit logs)

#### Database Schema
```sql
-- Secret Metadata
CREATE TABLE "Secret" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(50) NOT NULL, -- 'env', 'docker', 'k8s', 'hsm'
  rotation_period_days INTEGER,
  last_rotated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Secret Versions
CREATE TABLE "SecretVersion" (
  id SERIAL PRIMARY KEY,
  secret_id INTEGER REFERENCES "Secret"(id) ON DELETE CASCADE,
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP, -- grace period end
  UNIQUE(secret_id, hash)
);

-- Audit Trail
CREATE TABLE "SecretAuditLog" (
  id SERIAL PRIMARY KEY,
  secret_id INTEGER REFERENCES "Secret"(id),
  action VARCHAR(50) NOT NULL, -- 'access', 'rotate', 'rotation_failed'
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  ip_address INET,
  status VARCHAR(20), -- 'success', 'error'
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(secret_id, created_at),
  INDEX(user_id, created_at)
);
```

#### APIs (Internal)
```
getSecret(name: string)                     # Get current secret value
getVersions(name: string)                   # Get all valid versions (for rotation grace)
rotateSecret(name: string)                  # Rotate a secret
getAuditLog(name?: string)                  # Get audit trail
verifySecretAccess(token: string, secret: string) # Validate token against secret (for JWT)
```

#### Frontend
- Admin panel for secret rotation tracking
- Audit log viewer (filtered by secret)
- Rotation schedule management

#### Backend
- `services/secrets/SecretsManager.ts` - Main orchestrator
- `services/secrets/sources/` - Secret source implementations
- `services/secrets/audit/loggerAuditLog.ts` - Audit logging
- `services/secrets/hsm/stubHsmProvider.ts` - HSM stub (for future)
- `middleware/auth.ts` - Verify JWT against multiple secret versions
- `routes/auth.ts` - Use `secretsManager.get()` for signing
- `scripts/check-no-client-secrets.mjs` - CI check for leaked secrets

#### Security Requirements
- ✅ Secrets never logged in plaintext
- ✅ Secrets only accessible server-side
- ✅ Versioning allows grace period during rotation
- ✅ Audit log tracks all access, rotations, failures
- ✅ Rotation can be triggered manually or scheduled
- ✅ Type safety: declared secrets only (Zod schema)
- ✅ Placeholder fallback for non-production (prevents missing-key crashes)
- ✅ HSM stub ready for hardware-backed secrets in production

#### Testing
- ✅ Unit tests: Secret versioning, grace period logic
- ✅ Unit tests: Audit logging (no values captured)
- ✅ Integration tests: Rotation and token validation
- ✅ Integration tests: Secret source switching
- ✅ E2E tests: Rotation without invalidating active tokens
- ✅ Security tests: Plaintext leakage detection
- ✅ Coverage target: >90%

#### Documentation
- `docs/security/SECRET_MANAGEMENT.md` - Full architecture
- `docs/operations/SECRET_ROTATION.md` - Rotation procedures
- `docs/security/AUDIT_LOGGING.md` - Audit trail reference
- `.env.example` - Secret catalog template

#### Deployment
- Secrets sourced from environment-appropriate provider (env → Docker → Kubernetes → HSM)
- Rotation schedule configurable per environment
- Audit logs persisted to PostgreSQL
- Automated rotation alerts sent to ops team
- Zero-downtime rotation with grace period

#### Future Extensibility
- [ ] Hardware security module (HSM) integration
- [ ] Key management service (AWS KMS, Azure KeyVault)
- [ ] Automatic rotation scheduling
- [ ] Per-tenant secret isolation
- [ ] Certificate management for mTLS

---

### Module 1.4: Environment Management

**Status**: ✅ Completed (Stabilization Session - Branch 3)  
**Complexity**: Medium  
**Owner**: DevOps Team

#### Purpose
Type-safe configuration management using a two-axis model: `DeploymentStage` (development/testing/qa/staging/production) and `OperatingMode` (offline/mock/enterprise/government/self-hosted). Replaces scattered `process.env` reads with a validated, single-source-of-truth config object.

#### Architecture
- **DeploymentStage** enum - Exactly one of 5 stages
- **OperatingMode** bitset - Zero or more modes (allows combinations)
- **AppConfig interface** - Typed configuration object
- **Zod schema validation** - Runtime validation at startup
- **Config loader** - Assembles config from environment/secrets
- **Stage/mode-conditional defaults** - Different defaults per stage/mode
- **Compliance hooks** - Government/enterprise mode special handling

#### Dependencies
- Secrets Management (for sensitive config values)
- Logging (for config load errors)

#### Database Schema
```sql
-- Config Audit Trail
CREATE TABLE "ConfigChangeLog" (
  id SERIAL PRIMARY KEY,
  deployment_stage VARCHAR(20),
  operating_modes VARCHAR(255),
  changed_fields JSONB,
  changed_by VARCHAR(255), -- 'system' or user
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(deployment_stage, created_at)
);
```

#### Configuration Schema (Zod)
```typescript
export const AppConfigSchema = z.object({
  // Deployment metadata
  stage: z.enum(['development', 'testing', 'qa', 'staging', 'production']),
  modes: z.array(z.enum(['offline', 'mock', 'enterprise', 'government', 'self-hosted'])),

  // Server
  server: z.object({
    port: z.number().int().positive(),
    nodeEnv: z.enum(['development', 'production']),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  }),

  // Database
  database: z.object({
    url: z.string().url(),
    poolSize: z.number().int().positive(),
    sslMode: z.enum(['disable', 'require']).optional(),
  }),

  // Authentication
  auth: z.object({
    jwtExpiry: z.string().default('15m'),
    refreshTokenExpiry: z.string().default('7d'),
    sessionTimeout: z.string().default('7d'),
    bcryptRounds: z.number().int().min(10).default(12),
  }),

  // CORS
  cors: z.object({
    origins: z.array(z.string().url()),
    credentials: z.boolean().default(true),
  }),

  // API limits
  limits: z.object({
    maxRequestSize: z.string().default('10mb'),
    requestTimeout: z.string().default('30s'),
    maxConnections: z.number().int().positive(),
  }),

  // Feature flags
  features: z.object({
    mfa: z.boolean().default(true),
    oauth: z.boolean().default(true),
    analytics: z.boolean().default(true),
  }),

  // Compliance (stage/mode dependent)
  compliance: z.object({
    gdprMode: z.boolean().default(false),
    hipaaMode: z.boolean().default(false),
    dataResidency: z.enum(['us', 'eu', 'global']).default('global'),
  }),
});
```

#### APIs (Internal)
```
getConfig(): AppConfig                      # Get validated config
getStage(): DeploymentStage                 # Get current deployment stage
hasMode(mode: OperatingMode): boolean       # Check if mode is active
```

#### Frontend
- None (config is backend-only, frontend gets it via API calls)

#### Backend
- `config/types.ts` - Type definitions
- `config/schema.ts` - Zod schema
- `config/defaults.ts` - Default values per stage/mode
- `config/configLoader.ts` - Load and validate config
- `config/index.ts` - Export main API
- `middleware/errorHandler.ts` - Use config for error verbosity
- `routes/auth.ts` - Use config for JWT expiry
- `index.ts` - Load config at startup (async bootstrap)

#### Security Requirements
- ✅ Config loaded once at startup (immutable after)
- ✅ Sensitive values sourced from secrets manager
- ✅ Stage-specific defaults (production stricter than development)
- ✅ CORS origins validated against config
- ✅ Compliance mode enforcement (government/enterprise)
- ✅ Config changes audit-logged
- ✅ No config values hardcoded in code

#### Testing
- ✅ Unit tests: Zod schema validation
- ✅ Unit tests: Stage/mode defaults
- ✅ Integration tests: Config loading from environment
- ✅ Integration tests: Config + secrets integration
- ✅ E2E tests: Different stage/mode combinations
- ✅ Coverage target: >85%

#### Documentation
- `docs/operations/ENVIRONMENT_MANAGEMENT.md` - Config architecture
- `docs/operations/ENVIRONMENT_MIGRATION_GUIDE.md` - How to use config
- `.env.example` - Config template with all options

#### Deployment
- Config loaded from environment variables
- Stage/mode inferred from `DEPLOYMENT_STAGE` and `OPERATING_MODES` env vars
- Defaults vary by stage (stricter in production)
- Config immutable after server startup
- Config changes require restart

#### Future Extensibility
- [ ] Remote config management (Consul, etcd)
- [ ] Dynamic feature flags (per-user, per-tenant)
- [ ] Config versioning and rollback
- [ ] Multi-tenancy support (config per tenant)
- [ ] A/B testing framework

---

### Module 1.5: Local Development Runtime

**Status**: ✅ Completed (Stabilization Session - Branch 5)  
**Complexity**: High  
**Owner**: DevEx Team

#### Purpose
Complete mock implementation of all 21 capabilities plus cassette recording/replay (VCR pattern) for local development, testing, and offline work. Eliminates need for live API credentials during development while enabling realistic workflows and replay-based testing.

#### Architecture
- **DevRuntimeConfig** - Configure behavior (deterministic PRNG seed, latency simulation, failure injection)
- **InvocationLog** - Record all invocations (for debugging)
- **Cassette store** - Record/replay invocations for tests
- **DevRuntimeCapabilityProvider** - Decorator wrapping all providers
- **Mock data generation** - Seeded PRNG for deterministic outputs
- **Latency simulation** - Realistic timing for performance testing

#### Dependencies
- Provider Layer (decorates all providers)
- Config Management (for enabling/disabling dev runtime)

#### Database Schema
None (in-memory + filesystem cassettes)

#### Configuration Schema
```typescript
export const DevRuntimeConfig = {
  enabled: boolean,
  seed: number, // PRNG seed for deterministic outputs
  latencyMs: {
    textGeneration: [100, 500],     // [min, max] random range
    imageGeneration: [1000, 3000],
    videoGeneration: [5000, 10000],
    ...
  },
  failureRate: {
    textGeneration: 0.01,            // 1% failure rate
    imageGeneration: 0.02,
    ...
  },
  recordMode: 'none' | 'overwrite' | 'new_interactions', // Cassette mode
  cassettePath: './test-fixtures/cassettes',
};
```

#### APIs (Internal)
```
DevRuntimeCapabilityProvider.decorate(provider)     # Wrap provider
InvocationLog.record(capability, input, output)     # Record invocation
CassetteStore.record(cassette, interaction)         # Save cassette
CassetteStore.replay(cassette, input)               # Replay interaction
```

#### Frontend
- Debug panel showing all mock invocations
- Cassette browser/editor
- Latency simulator UI

#### Backend
- `services/devRuntime/DevRuntimeConfig.ts` - Config
- `services/devRuntime/InvocationLog.ts` - Logging
- `services/devRuntime/cassettes/CassetteStore.ts` - Record/replay
- `services/devRuntime/DevRuntimeCapabilityProvider.ts` - Decorator
- `services/devRuntime/mock/mockDataGenerator.ts` - Data generation
- `index.ts` - Conditionally wrap all providers

#### Security Requirements
- ✅ Dev runtime only enabled in development/testing stages
- ✅ Never used in production
- ✅ Cassettes don't contain real API credentials
- ✅ Mock data clearly labeled as mock

#### Testing
- ✅ Unit tests: PRNG determinism
- ✅ Unit tests: Cassette record/replay
- ✅ Integration tests: Full capability flow with mocks
- ✅ E2E tests: Complete user workflow with mocked AI providers
- ✅ Performance tests: Latency simulation accuracy
- ✅ Coverage target: >80%

#### Documentation
- `docs/development/LOCAL_DEV_RUNTIME.md` - Architecture & usage
- `docs/development/CASSETTE_RECORDING.md` - How to record/replay cassettes
- `docs/development/MOCK_PROVIDERS.md` - Mock implementation details
- Example cassettes in `test-fixtures/cassettes/`

#### Deployment
- Only deployed to development environments
- Disabled in staging/production via config
- Cassettes stored in version control for reproducible tests

#### Future Extensibility
- [ ] GraphQL subscription replay
- [ ] WebSocket message recording
- [ ] Live provider/mock switching (hot-swap)
- [ ] Synthetic scenario generation
- [ ] Performance profiling tools

---

## Phase 2: Content Creation Layer

These modules implement the core content generation capabilities that drive Synora's value proposition.

### Module 2.1: Document Management

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: Medium  
**Owner**: Content Team

#### Purpose
Create, organize, and manage documents (text, HTML, Markdown) as the base asset type that other capabilities augment. Documents form the foundation for all content workflows.

#### Architecture
- **Document entity** - Container for content
- **Version control** - Keep history of changes
- **Rich content support** - Markdown, HTML, plain text
- **Folder hierarchy** - Organize documents
- **Access control** - Share/collaborate at document/folder level
- **Metadata** - Tags, custom fields, creation info

#### Dependencies
- Authentication & Authorization (who can access)
- Permissions & Roles (from Phase 3, or local for MVP)

#### Database Schema
```sql
-- Documents
CREATE TABLE "Document" (
  id SERIAL PRIMARY KEY,
  project_id INTEGER, -- future workspace support
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  format VARCHAR(20) NOT NULL, -- 'markdown', 'html', 'plain'
  content TEXT NOT NULL,
  tags JSONB,
  metadata JSONB,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(project_id)
);

-- Document Versions
CREATE TABLE "DocumentVersion" (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_by INTEGER REFERENCES "User"(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version_number)
);

-- Folders
CREATE TABLE "DocumentFolder" (
  id SERIAL PRIMARY KEY,
  project_id INTEGER,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  parent_id INTEGER REFERENCES "DocumentFolder"(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id, parent_id, name)
);

-- Document-Folder relationship
CREATE TABLE "DocumentInFolder" (
  document_id INTEGER PRIMARY KEY REFERENCES "Document"(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES "DocumentFolder"(id) ON DELETE CASCADE
);
```

#### APIs (REST)
```
POST   /documents                           # Create document
GET    /documents                           # List user's documents
GET    /documents/:id                       # Get document
PATCH  /documents/:id                       # Update document
DELETE /documents/:id                       # Delete document
GET    /documents/:id/versions              # Get version history
POST   /documents/:id/versions/:versionId   # Restore to version
POST   /folders                             # Create folder
GET    /folders                             # List folders
PATCH  /folders/:id                         # Update folder
DELETE /folders/:id                         # Delete folder
POST   /documents/:id/share                 # Share with user
GET    /documents/:id/shared-with           # List who has access
```

#### Frontend
- Rich text editor (Monaco or similar)
- Document list/browser
- Folder navigation
- Version history viewer
- Markdown preview
- Sharing interface

#### Backend
- `models/Document.ts` - Document entity
- `services/documentService.ts` - CRUD operations
- `services/versionService.ts` - Version management
- `services/folderService.ts` - Folder operations
- `routes/documents.ts` - API endpoints
- `middleware/documentAccess.ts` - Access control

#### Security Requirements
- ✅ Users can only access their own documents
- ✅ Document sharing respects role-based access
- ✅ Soft deletes (documents marked deleted, not hard-deleted)
- ✅ Audit log for document access/modifications
- ✅ Version history immutable (changes tracked)

#### Testing
- ✅ Unit tests: Document entity validation
- ✅ Integration tests: CRUD operations
- ✅ Integration tests: Version management
- ✅ E2E tests: Complete document lifecycle
- ✅ Coverage target: >80%

#### Documentation
- `docs/features/DOCUMENT_MANAGEMENT.md` - Architecture
- `docs/api/document-endpoints.md` - API reference

#### Deployment
- Document storage in PostgreSQL
- Version history retention: indefinite
- Soft deletes: retention 30 days, then hard-delete

#### Future Extensibility
- [ ] Full-text search
- [ ] Collaborative editing (real-time)
- [ ] Comments and annotations
- [ ] Templates system
- [ ] Automatic backup/export

---

### Module 2.2: Image Generation

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: Medium  
**Owner**: AI Integration Team

#### Purpose
Generate images from text descriptions using OpenAI DALL-E, Midjourney, Stable Diffusion, or similar providers. Integrates with the Provider Layer to support multiple backends.

#### Architecture
- **Image generation request** - Prompt, style, size, model selection
- **Provider selection** - Auto-choose best provider via CapabilityResolver
- **Image storage** - Save to S3/cloud storage with metadata
- **Generation tracking** - Track cost, latency, user
- **Gallery UI** - Browse and manage generated images

#### Dependencies
- Provider Layer (capability invocation)
- Secrets Management (provider API keys)
- Document Management (optional: attach images to documents)

#### Database Schema
```sql
-- Image Generation Jobs
CREATE TABLE "ImageGenerationJob" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  style VARCHAR(100),
  size VARCHAR(20), -- '256x256', '512x512', '1024x1024', etc.
  num_images INTEGER DEFAULT 1,
  model VARCHAR(100), -- 'dall-e-3', 'midjourney', 'stable-diffusion', etc.
  provider VARCHAR(100), -- auto-selected or user-specified
  status VARCHAR(20) NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  result_urls JSONB, -- Array of generated image URLs
  cost_usd DECIMAL(10, 4),
  latency_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(status)
);

-- Image Metadata
CREATE TABLE "Image" (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES "ImageGenerationJob"(id) ON DELETE CASCADE,
  url VARCHAR(500) NOT NULL,
  local_path VARCHAR(500),
  metadata JSONB, -- seed, guidance, steps, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
POST   /images/generate                     # Start image generation
GET    /images/generate/:jobId              # Get job status
GET    /images                              # List user's images
GET    /images/:id                          # Get image details
DELETE /images/:id                          # Delete image
POST   /images/:id/download                 # Download image
```

#### Frontend
- Image generation form (prompt, settings, provider choice)
- Generation status/progress
- Image gallery
- Image editing/enhancement UI
- Download options

#### Backend
- `services/capabilities/imageGenerationProvider.ts` - Provider adapter
- `services/imageService.ts` - Image CRUD, job management
- `routes/images.ts` - API endpoints
- `workers/imageGenerationWorker.ts` - Async job processing (optional)

#### Security Requirements
- ✅ Users can only generate with API keys from their account
- ✅ Cost tracking to prevent runaway spending
- ✅ Image storage private by default, shareable by owner
- ✅ Prompt logging for moderation/filtering (no explicit content)
- ✅ Rate limiting per user to prevent abuse

#### Testing
- ✅ Unit tests: Job status tracking
- ✅ Integration tests: Provider selection
- ✅ E2E tests: Full generation workflow with mock provider
- ✅ Coverage target: >75%

#### Documentation
- `docs/features/IMAGE_GENERATION.md` - Architecture
- `docs/api/image-endpoints.md` - API reference

#### Deployment
- Image storage: S3/cloud provider
- Job queue: In-memory (or Redis for horizontal scaling)
- Cost tracking: Real-time against user budget

#### Future Extensibility
- [ ] Image editing (inpainting, outpainting)
- [ ] Style transfer
- [ ] Upscaling
- [ ] Batch generation
- [ ] Template-based generation

---

### Module 2.3: Video Generation

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: High  
**Owner**: AI Integration Team

#### Purpose
Generate videos from text descriptions using Runway, Synthesia, or similar providers. Integrates with Provider Layer for multi-provider support.

#### Architecture
- **Video generation request** - Prompt, duration, style, music
- **Provider selection** - Auto-choose best provider
- **Video processing** - Handle long-running jobs (webhook callbacks)
- **Video storage** - Save to cloud storage with metadata
- **Progress tracking** - Real-time job status via WebSocket

#### Dependencies
- Provider Layer
- Secrets Management
- Document Management (optional)
- WebSocket support (for progress updates)

#### Database Schema
```sql
-- Video Generation Jobs
CREATE TABLE "VideoGenerationJob" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  duration_seconds DECIMAL(5, 2),
  style VARCHAR(100),
  music_type VARCHAR(50), -- 'none', 'background', 'licensed'
  model VARCHAR(100),
  provider VARCHAR(100),
  status VARCHAR(20) NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  result_url VARCHAR(500),
  cost_usd DECIMAL(10, 4),
  latency_ms INTEGER,
  error_message TEXT,
  webhook_status VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(status)
);

-- Video Metadata
CREATE TABLE "VideoMetadata" (
  id SERIAL PRIMARY KEY,
  job_id INTEGER UNIQUE REFERENCES "VideoGenerationJob"(id) ON DELETE CASCADE,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  codec VARCHAR(50),
  file_size_bytes BIGINT,
  metadata JSONB
);
```

#### APIs (REST + WebSocket)
```
POST   /videos/generate                     # Start video generation
GET    /videos/generate/:jobId              # Get job status
WS     /videos/generate/:jobId/progress     # WebSocket for progress updates
GET    /videos                              # List user's videos
GET    /videos/:id                          # Get video details
DELETE /videos/:id                          # Delete video
POST   /videos/:id/download                 # Download video
```

#### Frontend
- Video generation form (prompt, duration, style)
- Progress bar with WebSocket updates
- Video player
- Video gallery
- Download/share options

#### Backend
- `services/capabilities/videoGenerationProvider.ts` - Provider adapter
- `services/videoService.ts` - Video CRUD, job management
- `routes/videos.ts` - API endpoints
- `workers/videoGenerationWorker.ts` - Async job processing
- `websockets/videoProgressHandler.ts` - WebSocket progress updates

#### Security Requirements
- ✅ Users can only generate with their account
- ✅ Cost limits to prevent runaway spending
- ✅ Video storage private by default
- ✅ Long-running jobs don't block main thread
- ✅ Webhook callbacks authenticated

#### Testing
- ✅ Unit tests: Job state machine
- ✅ Integration tests: Provider selection
- ✅ E2E tests: Full generation workflow
- ✅ Load tests: Multiple concurrent jobs
- ✅ Coverage target: >75%

#### Documentation
- `docs/features/VIDEO_GENERATION.md` - Architecture
- `docs/api/video-endpoints.md` - API reference

#### Deployment
- Video storage: S3/cloud provider
- Job queue: Redis (for horizontal scaling)
- Webhooks: Provider callbacks for completion
- Progress tracking: WebSocket + polling fallback

#### Future Extensibility
- [ ] Video editing (cut, trim, merge)
- [ ] Multi-scene videos
- [ ] Custom avatar support
- [ ] Batch video generation
- [ ] Video subtitles/captions

---

### Module 2.4: Audio & Music Generation

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: Medium  
**Owner**: AI Integration Team

#### Purpose
Generate audio (voiceovers, sound effects) and music from text descriptions using OpenAI TTS, Elevenlabs, or similar providers.

#### Architecture
- **Audio generation request** - Text/description, voice, language, quality
- **Provider selection** - Auto-choose best provider
- **Audio storage** - Save to cloud storage
- **Multiple output formats** - MP3, WAV, etc.
- **Voice cloning** - Clone user's voice (future)

#### Dependencies
- Provider Layer
- Secrets Management

#### Database Schema
```sql
-- Audio Generation Jobs
CREATE TABLE "AudioGenerationJob" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  text_input TEXT,
  audio_type VARCHAR(20) NOT NULL, -- 'voiceover', 'music', 'sfx'
  voice_id VARCHAR(100),
  language VARCHAR(20),
  speed DECIMAL(2, 1), -- 0.5 to 2.0
  model VARCHAR(100),
  provider VARCHAR(100),
  status VARCHAR(20),
  result_url VARCHAR(500),
  cost_usd DECIMAL(10, 4),
  latency_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX(user_id, created_at)
);

-- Audio Metadata
CREATE TABLE "AudioMetadata" (
  id SERIAL PRIMARY KEY,
  job_id INTEGER UNIQUE REFERENCES "AudioGenerationJob"(id) ON DELETE CASCADE,
  duration_ms INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  codec VARCHAR(50),
  bitrate VARCHAR(20),
  file_size_bytes BIGINT
);
```

#### APIs (REST)
```
POST   /audio/generate                      # Generate audio
GET    /audio/generate/:jobId               # Get job status
GET    /audio                               # List user's audio
DELETE /audio/:id                           # Delete audio
POST   /audio/:id/download                  # Download audio
```

#### Frontend
- Audio generation form (text input, voice/language selection)
- Audio player with waveform
- Audio gallery
- Download options

#### Backend
- `services/capabilities/audioGenerationProvider.ts`
- `services/audioService.ts`
- `routes/audio.ts`

#### Security Requirements
- ✅ User privacy for voice cloning inputs
- ✅ Cost tracking and limits

#### Testing
- ✅ Unit tests: Job management
- ✅ Integration tests: Provider integration
- ✅ E2E tests: Full generation workflow
- ✅ Coverage target: >75%

#### Documentation
- `docs/features/AUDIO_GENERATION.md`
- `docs/api/audio-endpoints.md`

#### Deployment
- Audio storage: S3/cloud provider
- Job queue: In-memory or Redis

#### Future Extensibility
- [ ] Voice cloning
- [ ] Multi-language support
- [ ] Custom voice training
- [ ] Real-time audio streaming
- [ ] Audio mixing/editing

---

### Module 2.5: Writing Assistant

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: Medium  
**Owner**: AI Integration Team

#### Purpose
AI-powered writing tools: content generation, editing, style improvement, paraphrasing, etc. Integrates with Document Management for seamless content creation.

#### Architecture
- **Writing operations** - Generate, edit, improve, summarize, translate
- **Context awareness** - Use document context for better results
- **Real-time streaming** - Stream generated content to user
- **Undo/redo** - Track changes

#### Dependencies
- Provider Layer (text generation)
- Document Management (edit documents in place)

#### Database Schema
```sql
-- Writing Jobs
CREATE TABLE "WritingJob" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  operation VARCHAR(50), -- 'generate', 'edit', 'improve', 'summarize'
  context TEXT,
  prompt TEXT,
  model VARCHAR(100),
  provider VARCHAR(100),
  status VARCHAR(20),
  result TEXT,
  cost_usd DECIMAL(10, 4),
  latency_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX(user_id, created_at)
);
```

#### APIs (REST + WebSocket)
```
POST   /writing/generate                    # Generate content
POST   /writing/edit                        # Edit text
POST   /writing/improve                     # Improve writing
POST   /writing/summarize                   # Summarize content
WS     /writing/:jobId/stream               # Stream results
```

#### Frontend
- In-editor writing assistant
- Floating command palette
- Streaming text animation
- Undo/redo for changes
- Suggestion insertion

#### Backend
- `services/capabilities/textGenerationProvider.ts`
- `services/writingService.ts`
- `routes/writing.ts`
- `websockets/writingStreamHandler.ts`

#### Security Requirements
- ✅ User content privacy
- ✅ Cost tracking

#### Testing
- ✅ Unit tests: Writing operations
- ✅ Integration tests: Document updates
- ✅ E2E tests: End-to-end writing workflow
- ✅ Coverage target: >75%

#### Documentation
- `docs/features/WRITING_ASSISTANT.md`
- `docs/api/writing-endpoints.md`

#### Deployment
- Streaming via WebSocket or Server-Sent Events

#### Future Extensibility
- [ ] Custom tone/style profiles
- [ ] Multi-language support
- [ ] Citation tracking
- [ ] Plagiarism detection
- [ ] Grammar/style linting

---

### Module 2.6: Code Assistant

**Status**: ⏳ Pending (Depends on Foundation complete)  
**Complexity**: Medium  
**Owner**: AI Integration Team

#### Purpose
AI-powered code generation: code completion, debugging, optimization, explanation, test generation, etc. Integrates with Document Management for code storage.

#### Architecture
- **Code operations** - Generate, debug, optimize, explain, test
- **Language awareness** - Detect/respect language context
- **Syntax highlighting** - Format generated code
- **Execution context** - Optional: execute code in sandbox

#### Dependencies
- Provider Layer (code generation)
- Document Management (store code)

#### Database Schema
```sql
-- Code Generation Jobs
CREATE TABLE "CodeGenerationJob" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES "Document"(id),
  operation VARCHAR(50), -- 'generate', 'debug', 'optimize'
  language VARCHAR(50),
  code_context TEXT,
  prompt TEXT,
  model VARCHAR(100),
  provider VARCHAR(100),
  status VARCHAR(20),
  result TEXT,
  cost_usd DECIMAL(10, 4),
  latency_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX(user_id, created_at)
);
```

#### APIs (REST + WebSocket)
```
POST   /code/generate                       # Generate code
POST   /code/debug                          # Debug code
POST   /code/optimize                       # Optimize code
POST   /code/explain                        # Explain code
POST   /code/test                           # Generate tests
WS     /code/:jobId/stream                  # Stream results
```

#### Frontend
- Code editor integration (Monaco/CodeMirror)
- Code suggestion insertion
- Streaming animation
- Syntax highlighting
- Language selection

#### Backend
- `services/capabilities/codeGenerationProvider.ts`
- `services/codeService.ts`
- `routes/code.ts`
- `websockets/codeStreamHandler.ts`

#### Security Requirements
- ✅ Code execution sandbox (if enabled)
- ✅ No arbitrary code execution

#### Testing
- ✅ Unit tests: Code operations
- ✅ Integration tests: Language detection
- ✅ E2E tests: End-to-end workflows
- ✅ Coverage target: >75%

#### Documentation
- `docs/features/CODE_ASSISTANT.md`
- `docs/api/code-endpoints.md`

#### Deployment
- Code execution: Optional sandbox (Ruby, Python, JavaScript)

#### Future Extensibility
- [ ] Multiple language support
- [ ] Custom rules/linting
- [ ] Performance profiling
- [ ] Security analysis
- [ ] Refactoring suggestions

---

## Phase 3: Collaboration Layer

These modules enable team-based workflows and shared content management.

### Module 3.1: Team Management

**Status**: ⏳ Pending (Depends on Phase 2 complete)  
**Complexity**: Medium  
**Owner**: Collaboration Team

#### Purpose
Manage teams, team membership, roles, and permissions for collaborative work.

#### Architecture
- **Team entity** - Group of users
- **Team membership** - Users in teams with roles
- **Team roles** - Admin, editor, viewer
- **Team settings** - Branding, limits, features

#### Dependencies
- Authentication (user identity)
- Permissions & Roles module

#### Database Schema
```sql
-- Teams
CREATE TABLE "Team" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id INTEGER REFERENCES "User"(id),
  logo_url VARCHAR(500),
  settings JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Team Members
CREATE TABLE "TeamMember" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL, -- 'admin', 'editor', 'viewer'
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_id)
);

-- Team Invitations
CREATE TABLE "TeamInvitation" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50),
  token VARCHAR(255) UNIQUE,
  expires_at TIMESTAMP,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
POST   /teams                                # Create team
GET    /teams                                # List user's teams
GET    /teams/:id                            # Get team details
PATCH  /teams/:id                            # Update team
DELETE /teams/:id                            # Delete team
POST   /teams/:id/members                    # Add team member
GET    /teams/:id/members                    # List team members
PATCH  /teams/:id/members/:memberId          # Update member role
DELETE /teams/:id/members/:memberId          # Remove member
POST   /teams/:id/invitations                # Invite member
GET    /teams/:id/invitations                # List invitations
POST   /teams/:id/invitations/:token/accept  # Accept invitation
```

#### Frontend
- Team creation/editing
- Member management UI
- Role assignment
- Invitation interface

#### Backend
- `services/teamService.ts`
- `routes/teams.ts`

#### Security Requirements
- ✅ Only team admins can modify team settings
- ✅ Only team admins can add/remove members
- ✅ Invitations expire after 7 days

#### Testing
- ✅ Unit tests: Team entity validation
- ✅ Integration tests: Member management
- ✅ E2E tests: Team creation/invitation workflows
- ✅ Coverage target: >80%

#### Documentation
- `docs/features/TEAM_MANAGEMENT.md`
- `docs/api/team-endpoints.md`

#### Deployment
- Team data in PostgreSQL

#### Future Extensibility
- [ ] Nested teams/hierarchies
- [ ] Team analytics
- [ ] Team API keys
- [ ] Audit logs per team

---

### Module 3.2: Workspace Management

**Status**: ⏳ Pending (Depends on Phase 2 complete)  
**Complexity**: Medium  
**Owner**: Collaboration Team

#### Purpose
Organize team content into workspaces (projects), with shared documents, settings, and collaboration tools.

#### Architecture
- **Workspace entity** - Container for team collaboration
- **Workspace members** - Users with roles
- **Shared documents** - Documents accessible to team
- **Workspace settings** - Naming, storage limits, features

#### Dependencies
- Team Management (workspaces belong to teams)
- Document Management (documents in workspaces)

#### Database Schema
```sql
-- Workspaces (Projects)
CREATE TABLE "Workspace" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  settings JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, name)
);

-- Workspace Access
CREATE TABLE "WorkspaceAccess" (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER REFERENCES "Workspace"(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL, -- 'admin', 'editor', 'viewer'
  UNIQUE(workspace_id, user_id)
);

-- Document-to-Workspace relationship
CREATE TABLE "DocumentInWorkspace" (
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  workspace_id INTEGER REFERENCES "Workspace"(id) ON DELETE CASCADE,
  PRIMARY KEY(document_id, workspace_id)
);
```

#### APIs (REST)
```
POST   /workspaces                           # Create workspace
GET    /workspaces                           # List workspaces
GET    /workspaces/:id                       # Get workspace
PATCH  /workspaces/:id                       # Update workspace
DELETE /workspaces/:id                       # Delete workspace
POST   /workspaces/:id/documents             # Add document to workspace
GET    /workspaces/:id/documents             # List workspace documents
DELETE /workspaces/:id/documents/:docId      # Remove from workspace
```

#### Frontend
- Workspace creation/editing
- Document organization within workspace
- Member access management
- Workspace navigation

#### Backend
- `services/workspaceService.ts`
- `routes/workspaces.ts`

#### Security Requirements
- ✅ Only workspace members can access content
- ✅ Role-based access control (viewer, editor, admin)

#### Testing
- ✅ Unit tests: Workspace entity
- ✅ Integration tests: Document sharing
- ✅ E2E tests: Workspace workflows
- ✅ Coverage target: >80%

#### Documentation
- `docs/features/WORKSPACE_MANAGEMENT.md`
- `docs/api/workspace-endpoints.md`

#### Deployment
- Workspace data in PostgreSQL

#### Future Extensibility
- [ ] Workspace templates
- [ ] Workspace-level feature flags
- [ ] Storage quotas per workspace
- [ ] Audit logs per workspace

---

### Module 3.3: Permissions & Role Management

**Status**: ⏳ Pending (Depends on Team Management)  
**Complexity**: Medium  
**Owner**: Security Team

#### Purpose
Fine-grained permission system for documents, workspaces, and resources. Support role-based access control (RBAC) and attribute-based access control (ABAC).

#### Architecture
- **Roles** - Predefined: admin, editor, viewer, custom
- **Permissions** - Granular capabilities per role
- **Resource-based access** - Control per document/workspace
- **Inheritance** - Permissions inherit from parent
- **Audit** - Track permission changes

#### Dependencies
- Team Management (roles in teams)
- Document Management (permissions on documents)

#### Database Schema
```sql
-- Roles
CREATE TABLE "Role" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false, -- system roles can't be deleted
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions
CREATE TABLE "Permission" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  resource VARCHAR(100), -- 'document', 'workspace', 'team'
  action VARCHAR(50), -- 'read', 'write', 'delete', 'share'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role-Permission Mapping
CREATE TABLE "RolePermission" (
  role_id INTEGER REFERENCES "Role"(id) ON DELETE CASCADE,
  permission_id INTEGER REFERENCES "Permission"(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

-- Resource-Level Access
CREATE TABLE "ResourceAccess" (
  id SERIAL PRIMARY KEY,
  resource_type VARCHAR(50), -- 'document', 'workspace'
  resource_id INTEGER,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES "Role"(id),
  granted_by INTEGER REFERENCES "User"(id),
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  UNIQUE(resource_type, resource_id, user_id)
);
```

#### APIs (REST)
```
GET    /permissions                          # List all permissions
GET    /roles                                # List all roles
GET    /roles/:id/permissions                # Get permissions for role
POST   /resources/:type/:id/access           # Grant access to resource
GET    /resources/:type/:id/access           # List resource access
DELETE /resources/:type/:id/access/:userId   # Revoke access
```

#### Frontend
- Role/permission selector
- Access control matrix (resource × user)
- Permission editing

#### Backend
- `services/permissionService.ts`
- `middleware/authorization.ts` - Check permissions
- `routes/permissions.ts`

#### Security Requirements
- ✅ Permissions checked on every resource access
- ✅ Least privilege by default (viewer role)
- ✅ No permission escalation possible
- ✅ Audit trail for permission changes

#### Testing
- ✅ Unit tests: Permission evaluation
- ✅ Integration tests: Access control
- ✅ E2E tests: Multi-user access scenarios
- ✅ Coverage target: >85%

#### Documentation
- `docs/security/PERMISSIONS_RBAC.md`
- `docs/api/permission-endpoints.md`

#### Deployment
- Permissions in PostgreSQL
- Cached in-memory (invalidated on changes)

#### Future Extensibility
- [ ] Attribute-based access control (ABAC)
- [ ] Temporal access (time-limited)
- [ ] Delegation (grant permission to grant)
- [ ] Team-level permission templates

---

### Module 3.4: Real-time Collaboration

**Status**: ⏳ Pending (Depends on Document Management + Workspace Management)  
**Complexity**: High  
**Owner**: Collaboration Team

#### Purpose
Real-time co-editing of documents with multiple users, live presence indicators, and conflict-free text synchronization using Operational Transformation (OT) or CRDT.

#### Architecture
- **WebSocket server** - Broadcast document changes
- **Operational Transformation** - Merge concurrent edits
- **Presence tracking** - Show who's editing
- **Document snapshots** - Periodic full-state saves
- **Collaboration history** - Track all changes

#### Dependencies
- Document Management (documents being co-edited)
- Workspace Management (team collaboration)

#### Database Schema
```sql
-- Collaboration Sessions
CREATE TABLE "CollaborationSession" (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  active_participants INTEGER DEFAULT 0
);

-- Document Changes (Operational Transformation log)
CREATE TABLE "DocumentChange" (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  operation JSONB, -- {type: 'insert'|'delete', index, content}
  version INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(document_id, version)
);

-- User Presence
CREATE TABLE "UserPresence" (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES "Document"(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  cursor_position INTEGER,
  selected_range JSONB,
  active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);
```

#### APIs (WebSocket + REST)
```
WS     /collaborate/document/:id             # Join collaboration session
GET    /collaborate/document/:id/active-users # List active users
GET    /collaborate/document/:id/history     # Get change history
```

#### Frontend
- Real-time text editor with cursor tracking
- User presence indicators (avatars, colors)
- Change highlights
- Conflict resolution UI (if needed)
- Undo/redo (local only during collaboration)

#### Backend
- `websockets/collaborationHandler.ts` - WebSocket connection manager
- `services/collaborationService.ts` - OT/CRDT logic
- `services/presenceService.ts` - Track active users
- `routes/collaboration.ts` - REST endpoints
- `workers/collaborationWorker.ts` - Optional: horizontal scaling

#### Security Requirements
- ✅ Only workspace members can collaborate
- ✅ Changes attributed to user
- ✅ Conflict resolution deterministic
- ✅ No data loss during network failures

#### Testing
- ✅ Unit tests: OT algorithms
- ✅ Integration tests: Concurrent edits
- ✅ E2E tests: Multi-user collaboration
- ✅ Stress tests: Many concurrent users
- ✅ Coverage target: >80%

#### Documentation
- `docs/features/REAL_TIME_COLLABORATION.md`
- `docs/architecture/COLLABORATION_ARCHITECTURE.md`

#### Deployment
- WebSocket server (horizontal scaling with Redis pub/sub)
- Change history in PostgreSQL
- In-memory presence (with Redis for horizontal scaling)

#### Future Extensibility
- [ ] Comments and threads
- [ ] Change tracking (highlight versions)
- [ ] Branching and merging (document versions)
- [ ] Offline support (sync when online)
- [ ] Mobile app support

---

## Phase 4: Enterprise Layer

These modules support enterprise deployment, governance, and advanced features.

### Module 4.1: SSO/SAML Integration

**Status**: ⏳ Pending (Depends on Auth complete)  
**Complexity**: High  
**Owner**: Security Team

#### Purpose
Enterprise single sign-on (SSO) via SAML 2.0 and OpenID Connect, enabling integration with corporate identity providers.

#### Architecture
- **SAML 2.0 provider** - Accept SAML assertions
- **OpenID Connect provider** - Support OAuth2/OIDC flows
- **Metadata endpoints** - Standard federation metadata
- **Attribute mapping** - Map SAML attributes to user fields
- **Just-in-time provisioning** - Auto-create users from SAML

#### Dependencies
- Authentication & Authorization (extends existing auth)

#### Database Schema
```sql
-- SSO Configuration
CREATE TABLE "SSOProvider" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'saml', 'oidc'
  name VARCHAR(255),
  metadata_url VARCHAR(500),
  entity_id VARCHAR(500),
  certificate_pem TEXT,
  attribute_mappings JSONB, -- {email: 'http://attributes.example.com/email', ...}
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, type)
);

-- SSO User Mappings
CREATE TABLE "SSOUserMapping" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE CASCADE,
  sso_provider_id INTEGER REFERENCES "SSOProvider"(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  UNIQUE(sso_provider_id, external_id)
);
```

#### APIs (REST)
```
POST   /auth/saml/metadata                   # Get SAML metadata
POST   /auth/saml/acs                        # SAML assertion consumer service
GET    /auth/oidc/authorize                  # OIDC authorization endpoint
POST   /auth/oidc/token                      # OIDC token endpoint
POST   /auth/oidc/userinfo                   # OIDC userinfo endpoint
```

#### Frontend
- SAML configuration UI (admin)
- SSO login button
- SSO setup wizard

#### Backend
- `services/auth/samlProvider.ts`
- `services/auth/oidcProvider.ts`
- `routes/auth.ts` (extend existing)

#### Security Requirements
- ✅ SAML assertions verified with certificate
- ✅ SAML responses not replayed (check ID)
- ✅ Encrypted SAML assertions (if supported by IdP)
- ✅ OIDC tokens validated with JWK
- ✅ Audit log for all SSO events

#### Testing
- ✅ Unit tests: SAML assertion parsing
- ✅ Integration tests: SAML flow with mock IdP
- ✅ E2E tests: Full SAML/OIDC authentication
- ✅ Coverage target: >85%

#### Documentation
- `docs/enterprise/SSO_SAML.md`
- `docs/enterprise/OIDC_SETUP.md`

#### Deployment
- SAML certificates stored in secrets manager
- IdP metadata cached (refreshed hourly)
- SSO configuration per team in database

#### Future Extensibility
- [ ] WS-Federation
- [ ] Multiple IdP failover
- [ ] Conditional access policies
- [ ] Scoped tokens per IdP

---

### Module 4.2: Advanced Compliance

**Status**: ⏳ Pending (Depends on All features)  
**Complexity**: High  
**Owner**: Compliance/Legal Team

#### Purpose
Support for advanced compliance requirements (GDPR, HIPAA, SOC2, etc.) with data residency, encryption, audit logging, and retention policies.

#### Architecture
- **Compliance profiles** - GDPR, HIPAA, SOC2, etc.
- **Data encryption** - Encryption at rest and in transit
- **Data residency** - Geographic data location enforcement
- **Retention policies** - Auto-delete data after period
- **Audit logging** - Comprehensive audit trail
- **Access controls** - Role-based and attribute-based
- **Breach notification** - Automatic incident response

#### Dependencies
- Secrets Management (for encryption keys)
- Audit logging (across all modules)

#### Database Schema
```sql
-- Compliance Policies
CREATE TABLE "CompliancePolicy" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  profile VARCHAR(50) NOT NULL, -- 'gdpr', 'hipaa', 'soc2'
  data_residency VARCHAR(50), -- 'us', 'eu', 'global'
  encryption_required BOOLEAN DEFAULT true,
  retention_days INTEGER,
  audit_required BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, profile)
);

-- Data Residency
CREATE TABLE "DataResidencyLog" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  data_type VARCHAR(100), -- 'user_data', 'documents', 'files'
  region VARCHAR(50),
  stored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Encryption Audit
CREATE TABLE "EncryptionAudit" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  resource_type VARCHAR(100),
  resource_id INTEGER,
  algorithm VARCHAR(50),
  key_id VARCHAR(255),
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
GET    /compliance/policies                  # List compliance policies
POST   /compliance/policies                  # Create policy
GET    /compliance/audit                     # Get compliance audit log
POST   /compliance/data-subject-request      # Handle GDPR/CCPA request
GET    /compliance/certificates              # Get compliance certs
```

#### Frontend
- Compliance configuration UI
- Audit log viewer
- Data subject request forms
- Compliance reporting dashboard

#### Backend
- `services/compliance/complianceService.ts`
- `services/compliance/gdprService.ts` - GDPR specific
- `services/compliance/hipaaService.ts` - HIPAA specific
- `middleware/complianceEnforcement.ts` - Policy enforcement
- `routes/compliance.ts`

#### Security Requirements
- ✅ Encryption enforced per policy
- ✅ Data residency enforced
- ✅ Audit trail comprehensive
- ✅ Retention policies automated
- ✅ Right to be forgotten / access implemented
- ✅ Incident response procedures

#### Testing
- ✅ Unit tests: Compliance policy evaluation
- ✅ Integration tests: Multi-policy enforcement
- ✅ E2E tests: Full compliance workflows
- ✅ Coverage target: >85%

#### Documentation
- `docs/compliance/GDPR_COMPLIANCE.md`
- `docs/compliance/HIPAA_COMPLIANCE.md`
- `docs/compliance/SOC2_REQUIREMENTS.md`

#### Deployment
- Compliance policies in PostgreSQL
- Encryption keys in secrets manager
- Audit logs in PostgreSQL (immutable append-only)
- Automated retention cleanup jobs

#### Future Extensibility
- [ ] PCI-DSS compliance
- [ ] ISO 27001 compliance
- [ ] Custom compliance profiles
- [ ] Automated compliance reporting
- [ ] Third-party auditor access

---

### Module 4.3: Custom Model Training

**Status**: ⏳ Pending (Depends on Provider Layer)  
**Complexity**: Very High  
**Owner**: ML Engineering Team

#### Purpose
Fine-tune large language models on organization-specific data, creating custom models for improved performance on domain-specific tasks.

#### Architecture
- **Training pipeline** - Data preparation, fine-tuning, validation
- **Model registry** - Manage trained models
- **A/B testing** - Compare custom vs base models
- **Cost tracking** - Monitor training/inference costs
- **Deployment** - Deploy custom models via Provider Layer

#### Dependencies
- Provider Layer (use custom models)
- Document Management (training data from documents)
- Secrets Management (API keys for cloud ML services)

#### Database Schema
```sql
-- Fine-tuning Jobs
CREATE TABLE "FineTuningJob" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  base_model VARCHAR(255),
  training_data_count INTEGER,
  validation_data_count INTEGER,
  status VARCHAR(20), -- 'pending', 'training', 'completed', 'failed'
  custom_model_id VARCHAR(255),
  cost_usd DECIMAL(10, 4),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Training Data
CREATE TABLE "FineTuningData" (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES "FineTuningJob"(id) ON DELETE CASCADE,
  input TEXT,
  output TEXT,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model Versions
CREATE TABLE "CustomModel" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  name VARCHAR(255),
  base_model VARCHAR(255),
  custom_model_id VARCHAR(255) UNIQUE,
  job_id INTEGER REFERENCES "FineTuningJob"(id),
  performance_score DECIMAL(5, 2),
  is_active BOOLEAN DEFAULT false,
  deployed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
POST   /models/fine-tune                     # Start fine-tuning job
GET    /models/fine-tune/:jobId              # Get job status
GET    /models                               # List custom models
PATCH  /models/:id/activate                  # Deploy model
POST   /models/:id/compare                   # A/B test vs base
DELETE /models/:id                           # Delete model
```

#### Frontend
- Training data upload
- Training job monitoring
- Model comparison dashboard
- A/B testing results

#### Backend
- `services/ml/fineTuningService.ts`
- `services/ml/modelRegistry.ts`
- `services/ml/trainingPipeline.ts`
- `routes/models.ts`
- `workers/trainingWorker.ts`

#### Security Requirements
- ✅ Training data access controlled
- ✅ Custom models version-controlled
- ✅ Rollback to previous models possible
- ✅ Cost limits to prevent runaway spending

#### Testing
- ✅ Unit tests: Model management
- ✅ Integration tests: Training pipeline
- ✅ E2E tests: End-to-end training workflows
- ✅ Coverage target: >75%

#### Documentation
- `docs/ml/CUSTOM_MODEL_TRAINING.md`
- `docs/ml/TRAINING_DATA_PREPARATION.md`

#### Deployment
- Training via OpenAI/Anthropic APIs (initially)
- Custom models hosted on provider infrastructure
- Model registry in PostgreSQL

#### Future Extensibility
- [ ] On-premises model training
- [ ] Transfer learning across models
- [ ] Continuous retraining pipelines
- [ ] Model performance monitoring
- [ ] Automated hyperparameter tuning

---

### Module 4.4: Analytics Dashboard

**Status**: ⏳ Pending (Depends on All features)  
**Complexity**: High  
**Owner**: Analytics Team

#### Purpose
Comprehensive analytics dashboard tracking usage, costs, performance, and user behavior across all platform features.

#### Architecture
- **Event tracking** - Capture all user/system events
- **Time-series data** - Store metrics over time
- **Dashboards** - Pre-built and custom dashboards
- **Alerts** - Anomaly detection and notifications
- **Reporting** - Generate compliance/business reports
- **Data warehouse** - Aggregate data for analysis

#### Dependencies
- All modules (events from everywhere)

#### Database Schema
```sql
-- Events
CREATE TABLE "Event" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES "User"(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE SET NULL,
  event_type VARCHAR(100),
  event_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(user_id, created_at),
  INDEX(team_id, created_at),
  INDEX(event_type, created_at)
);

-- Metrics (time-series)
CREATE TABLE "Metric" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  metric_name VARCHAR(100),
  metric_value DECIMAL(15, 2),
  dimensions JSONB, -- {capability: 'text_generation', provider: 'openai'}
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(team_id, metric_name, recorded_at)
);

-- Dashboard Configurations
CREATE TABLE "DashboardConfig" (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES "Team"(id) ON DELETE CASCADE,
  name VARCHAR(255),
  config JSONB, -- {widgets: [...], refresh_interval_ms: ...}
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### APIs (REST)
```
GET    /analytics/events                     # List events
GET    /analytics/metrics                    # Get metrics
GET    /analytics/dashboards                 # List dashboards
POST   /analytics/dashboards                 # Create dashboard
GET    /analytics/dashboards/:id             # Get dashboard
GET    /analytics/reports                    # List reports
POST   /analytics/reports                    # Generate report
```

#### Frontend
- Customizable dashboards
- Real-time metric display
- Charts (line, bar, pie, etc.)
- Alerts configuration
- Report generation UI
- Data export (CSV, PDF)

#### Backend
- `services/analytics/eventService.ts`
- `services/analytics/metricsService.ts`
- `services/analytics/dashboardService.ts`
- `services/analytics/reportService.ts`
- `middleware/eventTracking.ts` - Intercept and track events
- `routes/analytics.ts`
- `workers/analyticsWorker.ts` - Aggregate metrics

#### Security Requirements
- ✅ Users see only their own data
- ✅ Admins see team-level data
- ✅ PII excluded from analytics (hashed)
- ✅ Event logs archived for compliance

#### Testing
- ✅ Unit tests: Metric aggregation
- ✅ Integration tests: Event tracking
- ✅ E2E tests: Dashboard workflows
- ✅ Coverage target: >75%

#### Documentation
- `docs/analytics/ANALYTICS_GUIDE.md`
- `docs/analytics/CUSTOM_REPORTS.md`

#### Deployment
- Events stored in PostgreSQL
- Metrics aggregated via background jobs
- Time-series data optimized (partitioned by date)
- Optional: ClickHouse or similar for analytics queries

#### Future Extensibility
- [ ] Machine learning anomaly detection
- [ ] Predictive analytics
- [ ] Cohort analysis
- [ ] Funnel analysis
- [ ] Attribution modeling

---

## Implementation Order

### Sequential Implementation (Recommended)

**Phase 1: Foundation (Weeks 1-4)**
1. ✅ Authentication & Authorization (completed)
2. ✅ Provider Abstraction Layer (completed)
3. ✅ Secrets Management (completed)
4. ✅ Environment Management (completed)
5. ✅ Local Development Runtime (completed)

**Phase 2: Content Creation (Weeks 5-12)**
6. Document Management (1-2 weeks)
7. Image Generation (1-2 weeks)
8. Video Generation (2 weeks)
9. Audio & Music Generation (1 week)
10. Writing Assistant (1 week)
11. Code Assistant (1 week)

**Phase 3: Collaboration (Weeks 13-16)**
12. Team Management (1 week)
13. Workspace Management (1 week)
14. Permissions & Role Management (1 week)
15. Real-time Collaboration (2 weeks)

**Phase 4: Enterprise (Weeks 17-24)**
16. SSO/SAML Integration (2 weeks)
17. Advanced Compliance (3 weeks)
18. Custom Model Training (4 weeks)
19. Analytics Dashboard (3 weeks)

**Total: ~6 months to MVP with all features**

---

## Risk Assessment

### High-Risk Areas
1. **Real-time Collaboration** - Operational Transformation complexity; requires careful testing
2. **Custom Model Training** - Depends on external ML APIs; cost and latency risks
3. **Advanced Compliance** - Regulatory requirements; needs legal review

### Mitigation Strategies
- Real-time Collaboration: Start with simple lock-based concurrency, upgrade to OT later
- Custom Model Training: Phase 2 approach (OpenAI fine-tuning), move to self-hosted later
- Advanced Compliance: Start with GDPR basics, add HIPAA/SOC2 incrementally

---

## Dependency Resolution

### Unblocking Strategy
If a module is blocked by dependencies:
1. Create **mocks** for upstream modules (use dev runtime mocks)
2. **Parallel implementation** - Write tests against mocks
3. **Integration testing** - Integrate with real module once available

Example: Code Assistant can be developed in parallel with Provider Layer by using mock providers.

---

## Testing Strategy

### All Modules Include
- **Unit tests**: >80% coverage on business logic
- **Integration tests**: Cross-module interaction
- **E2E tests**: Real user workflows
- **Security tests**: Auth, permissions, data protection
- **Performance tests**: Load, latency, throughput
- **Accessibility tests**: WCAG 2.1 AA compliance

---

## Documentation Standards

### Every Module Must Have
- **Architecture diagram** - Component relationships
- **Database schema** - Table definitions and relationships
- **API reference** - Endpoint documentation
- **Usage guide** - How to use the feature
- **Deployment guide** - How to deploy to production
- **Troubleshooting guide** - Common issues and solutions

---

## Success Metrics

### Per Module
- ✅ All tests passing (unit, integration, E2E)
- ✅ Code coverage >80%
- ✅ Zero security vulnerabilities (OWASP top 10)
- ✅ Documentation 100% complete
- ✅ Performance meets targets (latency, throughput)
- ✅ Accessibility WCAG 2.1 AA

### Platform-wide
- ✅ All modules integrated and working together
- ✅ CI/CD pipeline green
- ✅ Performance load test passing
- ✅ Security audit passed
- ✅ Compliance audit passed

---

## Rollback Plan

### If Module Fails Integration
1. Revert commits for that module
2. Keep module's database schema (for potential re-attempt)
3. Document lessons learned
4. Plan re-implementation with adjusted scope

---

## Version Control Strategy

### Branch Structure per Module
```
feature/<module-name>       # Main feature branch
feature/<module-name>/<task> # Sub-tasks
feature/<module-name>/docs  # Documentation
feature/<module-name>/tests # Test coverage
```

### Release Strategy
```
main              # Production (v1.0.0, v1.1.0, ...)
staging           # Pre-production testing
develop           # Integration branch
feature/*         # Feature branches
```

---

## Next Steps

1. **Phase 1 Review** - Ensure Foundation Layer is fully production-ready
2. **Phase 2 Planning** - Assign teams to Module 2.1 (Document Management)
3. **Dependency Mocking** - Set up mocks for Phase 2 development
4. **Testing Infrastructure** - Ensure CI/CD pipeline ready for all Phase 2 tests

---

**Document Owner**: Synora Engineering Leadership  
**Last Updated**: 2026-07-21  
**Status**: Ready for Phase 2 Implementation  
**Next Review**: After Phase 1 merge to main
