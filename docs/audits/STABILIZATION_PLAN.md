# Release 2 Stabilization Plan

## Critical Issues Found

### 1. Circular Dependencies (BLOCKING)
- **workspace.service.ts ↔ audit.service.ts**
  - workspace imports `recordAuditEvent` from audit.service
  - audit imports `requireMembership` from workspace.service
  - FIX: Move requireMembership to separate utility module

- **ai/registry.ts ↔ provider files**
  - providers import AIProviderDescriptor type from registry
  - registry imports provider descriptors
  - FIX: Move AIProviderDescriptor type to separate types file

- **mail/registry.ts ↔ transports**
  - Similar pattern as AI providers
  - FIX: Move type definitions

- **storage/registry.ts ↔ providers**
  - Similar pattern as AI providers
  - FIX: Move type definitions

### 2. Dead Code
- Unused exports in services layer (need per-file audit)
- Unused utility functions

### 3. Duplicate Code Patterns
- notifyWorkspaceOwner (appears in multiple services)
- notifyBestEffort (generic notify pattern)
- createWorkspace patterns
- FIX: Extract to shared notification utilities

### 4. Architecture Issues
- Provider registry directly imports implementations (tight coupling)
- FIX: Lazy load providers or use factory pattern

### 5. Naming/Organization
- Service files organized correctly (*.service.ts)
- Providers organized correctly (*.provider.ts)
- Transports organized correctly (*.transport.ts)
- ✓ No issues found

## Fixes to Apply (in order)

### Step 1: Break workspace ↔ audit circular dependency
1. Create apps/backend/src/services/checks.ts
2. Move requireMembership to checks.ts
3. Update workspace.service.ts to import from checks
4. Update audit.service.ts to import from checks

### Step 2: Extract duplicate notification code
1. Create apps/backend/src/services/notifications.ts
2. Move notifyWorkspaceOwner to notifications.ts
3. Move notifyBestEffort to notifications.ts
4. Update all callers

### Step 3: Fix AI provider circular dependency
1. Create apps/backend/src/ai/types/descriptor.ts
2. Move AIProviderDescriptor type to descriptor.ts
3. Update registry.ts to import from descriptor.ts
4. Update provider files to import from descriptor.ts

### Step 4: Fix mail transport circular dependency
1. Apply same pattern as AI providers

### Step 5: Fix storage provider circular dependency
1. Apply same pattern as AI providers

### Step 6: Verify all gates pass
1. Type-check
2. Lint
3. Build
4. Security audit
5. Tests

## Verification Checklist
- [ ] No circular imports (typescript-circular-dependency-plugin)
- [ ] No unused exports (tsslint/no-unused-variable)
- [ ] No dead code (eslint-plugin-unused-imports)
- [ ] All routes wired and tested
- [ ] All pages reachable from navigation
- [ ] No peer dependency warnings
- [ ] Build produces clean ESM
- [ ] All tests pass
- [ ] Type-check clean
- [ ] Lint clean

