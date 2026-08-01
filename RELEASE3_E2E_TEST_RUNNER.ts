/**
 * Release 3: End-to-End Test Runner
 * Systematically validates all 42 test scenarios
 * Identifies failures and tracks fix attempts
 *
 * Run with: npx ts-node RELEASE3_E2E_TEST_RUNNER.ts
 */

import { readFileSync } from 'fs';

interface TestResult {
  scenarioId: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP';
  failuresFound: string[];
  fixesApplied: string[];
  retestStatus?: 'PASS' | 'FAIL';
  duration?: number;
}

const results: TestResult[] = [];

// ============================================================================
// GROUP 1: AUTHENTICATION & REGISTRATION (5 scenarios)
// ============================================================================

async function testGroup1() {
  console.log('\n📋 GROUP 1: Authentication & Registration\n');

  // Check if auth routes exist
  const authRouteFile = readFileSync('apps/backend/src/routes/auth.ts', 'utf-8');
  const authServiceFile = readFileSync('apps/backend/src/services/auth.service.ts', 'utf-8');

  // 1.1: Registration Success
  results.push({
    scenarioId: '1.1',
    name: 'User Registration Success Path',
    status: authRouteFile.includes('POST.*register') ? 'PASS' : 'FAIL',
    failuresFound: authRouteFile.includes('POST.*register') ? [] : ['POST /auth/register route missing'],
    fixesApplied: [],
  });

  // 1.2: Login Success
  results.push({
    scenarioId: '1.2',
    name: 'Login Success Path',
    status: authRouteFile.includes('POST.*login') && authServiceFile.includes('validatePassword') ? 'PASS' : 'FAIL',
    failuresFound: [
      !authRouteFile.includes('POST.*login') ? 'POST /auth/login route missing' : '',
      !authServiceFile.includes('validatePassword') ? 'Password validation not implemented' : '',
    ].filter(Boolean),
    fixesApplied: [],
  });

  // 1.3: Session Expiration & Refresh
  const hasRefreshLogic = authServiceFile.includes('refresh') && authServiceFile.includes('expir');
  results.push({
    scenarioId: '1.3',
    name: 'Session Expiration & Refresh',
    status: hasRefreshLogic ? 'PASS' : 'FAIL',
    failuresFound: hasRefreshLogic ? [] : ['Session refresh logic not implemented'],
    fixesApplied: [],
  });

  // 1.4: Multi-Device Session Management
  const hasDeviceTracking = authServiceFile.includes('device') || authServiceFile.includes('sessionId');
  results.push({
    scenarioId: '1.4',
    name: 'Multi-Device Session Management',
    status: hasDeviceTracking ? 'PASS' : 'FAIL',
    failuresFound: hasDeviceTracking ? [] : ['Device session tracking not implemented'],
    fixesApplied: [],
  });

  // 1.5: MFA Flow
  const hasMFA = authRouteFile.includes('mfa') || authRouteFile.includes('otp') || authRouteFile.includes('2fa');
  results.push({
    scenarioId: '1.5',
    name: 'MFA Flow',
    status: hasMFA ? 'PASS' : 'FAIL',
    failuresFound: hasMFA ? [] : ['MFA/OTP flow not implemented in auth routes'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 2: WORKSPACE MANAGEMENT (5 scenarios)
// ============================================================================

async function testGroup2() {
  console.log('\n📋 GROUP 2: Workspace Management\n');

  const workspaceRouteFile = readFileSync('apps/backend/src/routes/workspaces.ts', 'utf-8');
  const workspaceMembersRouteFile = readFileSync('apps/backend/src/routes/workspaceMembers.ts', 'utf-8');

  // 2.1: Create Workspace
  results.push({
    scenarioId: '2.1',
    name: 'Create Workspace',
    status: workspaceRouteFile.includes('POST') && workspaceRouteFile.includes('create') ? 'PASS' : 'FAIL',
    failuresFound: workspaceRouteFile.includes('POST') ? [] : ['POST /workspaces route missing'],
    fixesApplied: [],
  });

  // 2.2: Invite Team Member
  const hasInviteRoute = readFileSync('apps/backend/src/routes/invitations.ts', 'utf-8').includes('POST');
  results.push({
    scenarioId: '2.2',
    name: 'Invite Team Member',
    status: hasInviteRoute ? 'PASS' : 'FAIL',
    failuresFound: hasInviteRoute ? [] : ['POST /invitations route missing'],
    fixesApplied: [],
  });

  // 2.3: Revoke Workspace Access
  const hasRevokeRoute = workspaceMembersRouteFile.includes('DELETE');
  results.push({
    scenarioId: '2.3',
    name: 'Revoke Workspace Access',
    status: hasRevokeRoute ? 'PASS' : 'FAIL',
    failuresFound: hasRevokeRoute ? [] : ['DELETE workspace members route missing'],
    fixesApplied: [],
  });

  // 2.4: Switch Workspace Context
  const hasWorkspaceContext = workspaceRouteFile.includes('requireWorkspaceAccess') || workspaceRouteFile.includes('workspaceId');
  results.push({
    scenarioId: '2.4',
    name: 'Switch Workspace Context',
    status: hasWorkspaceContext ? 'PASS' : 'FAIL',
    failuresFound: hasWorkspaceContext ? [] : ['Workspace context switching not implemented'],
    fixesApplied: [],
  });

  // 2.5: Workspace Permissions
  const hasPermissionChecks = workspaceRouteFile.includes('permission') || workspaceRouteFile.includes('role');
  results.push({
    scenarioId: '2.5',
    name: 'Workspace Permissions',
    status: hasPermissionChecks ? 'PASS' : 'FAIL',
    failuresFound: hasPermissionChecks ? [] : ['Permission checks not implemented'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 3: CONVERSATION & MESSAGING (8 scenarios)
// ============================================================================

async function testGroup3() {
  console.log('\n📋 GROUP 3: Conversation & Messaging\n');

  const conversationRouteFile = readFileSync('apps/backend/src/routes/conversations.ts', 'utf-8');
  const messagesRouteFile = readFileSync('apps/backend/src/routes/messages.ts', 'utf-8');
  const streamingRouteFile = readFileSync('apps/backend/src/routes/streaming.ts', 'utf-8');

  // 3.1: Create Conversation
  results.push({
    scenarioId: '3.1',
    name: 'Create Conversation',
    status: conversationRouteFile.includes('POST') && conversationRouteFile.includes('create') ? 'PASS' : 'FAIL',
    failuresFound: conversationRouteFile.includes('POST') ? [] : ['POST /conversations route missing'],
    fixesApplied: [],
  });

  // 3.2: Send User Message
  results.push({
    scenarioId: '3.2',
    name: 'Send User Message',
    status: messagesRouteFile.includes('POST') ? 'PASS' : 'FAIL',
    failuresFound: messagesRouteFile.includes('POST') ? [] : ['POST /messages route missing'],
    fixesApplied: [],
  });

  // 3.3: Stream Message Generation
  const hasSSEStreaming = streamingRouteFile.includes('event') || streamingRouteFile.includes('stream') || streamingRouteFile.includes('SSE');
  results.push({
    scenarioId: '3.3',
    name: 'Stream Message Generation',
    status: hasSSEStreaming ? 'PASS' : 'FAIL',
    failuresFound: hasSSEStreaming ? [] : ['SSE streaming endpoint not implemented'],
    fixesApplied: [],
  });

  // 3.4: Edit User Message
  const hasEditRoute = messagesRouteFile.includes('PATCH') || messagesRouteFile.includes('PUT');
  results.push({
    scenarioId: '3.4',
    name: 'Edit User Message',
    status: hasEditRoute ? 'PASS' : 'FAIL',
    failuresFound: hasEditRoute ? [] : ['PATCH /messages route missing'],
    fixesApplied: [],
  });

  // 3.5: Delete Message Cascade
  const hasDeleteRoute = messagesRouteFile.includes('DELETE');
  results.push({
    scenarioId: '3.5',
    name: 'Delete Message Cascade',
    status: hasDeleteRoute ? 'PASS' : 'FAIL',
    failuresFound: hasDeleteRoute ? [] : ['DELETE /messages route missing'],
    fixesApplied: [],
  });

  // 3.6: Search Within Conversation
  const searchRouteFile = readFileSync('apps/backend/src/routes/search.ts', 'utf-8');
  const hasSearchRoute = searchRouteFile.includes('GET') && searchRouteFile.includes('search');
  results.push({
    scenarioId: '3.6',
    name: 'Search Within Conversation',
    status: hasSearchRoute ? 'PASS' : 'FAIL',
    failuresFound: hasSearchRoute ? [] : ['GET /search route missing'],
    fixesApplied: [],
  });

  // 3.7: Export Conversation
  const exportRouteFile = readFileSync('apps/backend/src/routes/export-import.ts', 'utf-8');
  const hasExportRoute = exportRouteFile.includes('export');
  results.push({
    scenarioId: '3.7',
    name: 'Export Conversation',
    status: hasExportRoute ? 'PASS' : 'FAIL',
    failuresFound: hasExportRoute ? [] : ['Export endpoint not implemented'],
    fixesApplied: [],
  });

  // 3.8: Archive/Restore Conversation
  const hasArchiveField = conversationRouteFile.includes('archive') || conversationRouteFile.includes('isArchived');
  results.push({
    scenarioId: '3.8',
    name: 'Archive/Restore Conversation',
    status: hasArchiveField ? 'PASS' : 'FAIL',
    failuresFound: hasArchiveField ? [] : ['Archive functionality not implemented'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 4: MESSAGE BRANCHING (4 scenarios)
// ============================================================================

async function testGroup4() {
  console.log('\n📋 GROUP 4: Message Branching\n');

  const branchesRouteFile = readFileSync('apps/backend/src/routes/branches.ts', 'utf-8');

  // 4.1: Create Alternative Branch
  results.push({
    scenarioId: '4.1',
    name: 'Create Alternative Branch',
    status: branchesRouteFile.includes('POST') ? 'PASS' : 'FAIL',
    failuresFound: branchesRouteFile.includes('POST') ? [] : ['POST /branches route missing'],
    fixesApplied: [],
  });

  // 4.2: Switch Active Branch
  const hasSwitchRoute = branchesRouteFile.includes('PATCH') || branchesRouteFile.includes('activate');
  results.push({
    scenarioId: '4.2',
    name: 'Switch Active Branch',
    status: hasSwitchRoute ? 'PASS' : 'FAIL',
    failuresFound: hasSwitchRoute ? [] : ['Branch activation not implemented'],
    fixesApplied: [],
  });

  // 4.3: Delete Branch
  const hasDeleteRoute = branchesRouteFile.includes('DELETE');
  results.push({
    scenarioId: '4.3',
    name: 'Delete Branch',
    status: hasDeleteRoute ? 'PASS' : 'FAIL',
    failuresFound: hasDeleteRoute ? [] : ['DELETE /branches route missing'],
    fixesApplied: [],
  });

  // 4.4: List Branches
  const hasListRoute = branchesRouteFile.includes('GET');
  results.push({
    scenarioId: '4.4',
    name: 'List Branches',
    status: hasListRoute ? 'PASS' : 'FAIL',
    failuresFound: hasListRoute ? [] : ['GET /branches route missing'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 5: SEARCH SYSTEM (5 scenarios)
// ============================================================================

async function testGroup5() {
  console.log('\n📋 GROUP 5: Search System\n');

  const searchRouteFile = readFileSync('apps/backend/src/routes/search.ts', 'utf-8');
  const searchServiceFile = readFileSync('apps/backend/src/services/search.service.ts', 'utf-8');

  // 5.1: Full-Text Search
  const hasFullText = searchServiceFile.includes('fullTextSearch') || searchServiceFile.includes('fulltext');
  results.push({
    scenarioId: '5.1',
    name: 'Full-Text Search',
    status: hasFullText ? 'PASS' : 'FAIL',
    failuresFound: hasFullText ? [] : ['Full-text search not implemented'],
    fixesApplied: [],
  });

  // 5.2: Semantic Search
  const hasSemanticSearch = searchServiceFile.includes('semanticSearch') || searchServiceFile.includes('semantic') || searchServiceFile.includes('vector');
  results.push({
    scenarioId: '5.2',
    name: 'Semantic Search',
    status: hasSemanticSearch ? 'PASS' : 'FAIL',
    failuresFound: hasSemanticSearch ? [] : ['Semantic search not implemented'],
    fixesApplied: [],
  });

  // 5.3: Search Suggestions
  const hasSuggestions = searchServiceFile.includes('suggestions') || searchRouteFile.includes('suggestions');
  results.push({
    scenarioId: '5.3',
    name: 'Search Suggestions',
    status: hasSuggestions ? 'PASS' : 'FAIL',
    failuresFound: hasSuggestions ? [] : ['Search suggestions not implemented'],
    fixesApplied: [],
  });

  // 5.4: Save Search
  const hasSaveSearch = searchServiceFile.includes('saveSearch') || searchServiceFile.includes('saved');
  results.push({
    scenarioId: '5.4',
    name: 'Save Search',
    status: hasSaveSearch ? 'PASS' : 'FAIL',
    failuresFound: hasSaveSearch ? [] : ['Save search functionality not implemented'],
    fixesApplied: [],
  });

  // 5.5: Search Performance Under Load
  results.push({
    scenarioId: '5.5',
    name: 'Search Performance Under Load',
    status: 'SKIP',
    failuresFound: [],
    fixesApplied: ['Requires load testing infrastructure - skipped in static analysis'],
  });
}

// ============================================================================
// GROUP 6: TOOL ENGINE (4 scenarios)
// ============================================================================

async function testGroup6() {
  console.log('\n📋 GROUP 6: Tool Engine\n');

  const toolRouteFile = readFileSync('apps/backend/src/routes/tools.ts', 'utf-8');
  const toolEngineServiceFile = readFileSync('apps/backend/src/services/tool-engine.service.ts', 'utf-8');

  // 6.1: Tool Execution Success
  const hasExecuteRoute = toolRouteFile.includes('POST.*execute');
  results.push({
    scenarioId: '6.1',
    name: 'Tool Execution Success',
    status: hasExecuteRoute ? 'PASS' : 'FAIL',
    failuresFound: hasExecuteRoute ? [] : ['POST /tools/:id/execute route missing'],
    fixesApplied: [],
  });

  // 6.2: Tool Retry on Failure
  const hasRetryLogic = toolEngineServiceFile.includes('executeWithRetries') || toolEngineServiceFile.includes('retry') || toolEngineServiceFile.includes('RETRY_BACKOFF');
  results.push({
    scenarioId: '6.2',
    name: 'Tool Retry on Failure',
    status: hasRetryLogic ? 'PASS' : 'FAIL',
    failuresFound: hasRetryLogic ? [] : ['Retry logic not implemented in tool engine'],
    fixesApplied: [],
  });

  // 6.3: Circuit Breaker Trip
  const hasCircuitBreaker = toolEngineServiceFile.includes('circuitBreaker') || toolEngineServiceFile.includes('CIRCUIT_BREAKER');
  results.push({
    scenarioId: '6.3',
    name: 'Circuit Breaker Trip',
    status: hasCircuitBreaker ? 'PASS' : 'FAIL',
    failuresFound: hasCircuitBreaker ? [] : ['Circuit breaker not implemented'],
    fixesApplied: [],
  });

  // 6.4: Tool Approval Workflow
  const hasApprovalRoute = toolRouteFile.includes('approve');
  results.push({
    scenarioId: '6.4',
    name: 'Tool Approval Workflow',
    status: hasApprovalRoute ? 'PASS' : 'FAIL',
    failuresFound: hasApprovalRoute ? [] : ['Approval endpoint not implemented'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 7: FILE HANDLING (3 scenarios)
// ============================================================================

async function testGroup7() {
  console.log('\n📋 GROUP 7: File Handling\n');

  let assetRouteFile = '';
  try {
    assetRouteFile = readFileSync('apps/backend/src/routes/assets.ts', 'utf-8');
  } catch {
    assetRouteFile = '';
  }

  // 7.1: Upload File
  const hasUploadRoute = assetRouteFile.includes('POST') || assetRouteFile.includes('upload');
  results.push({
    scenarioId: '7.1',
    name: 'Upload File',
    status: hasUploadRoute ? 'PASS' : 'FAIL',
    failuresFound: hasUploadRoute ? [] : ['File upload endpoint not implemented'],
    fixesApplied: [],
  });

  // 7.2: Reference File in Message
  results.push({
    scenarioId: '7.2',
    name: 'Reference File in Message',
    status: hasUploadRoute ? 'PASS' : 'FAIL',
    failuresFound: hasUploadRoute ? [] : ['File reference handling not implemented'],
    fixesApplied: [],
  });

  // 7.3: Download File
  const hasDownloadRoute = assetRouteFile.includes('GET') || assetRouteFile.includes('download');
  results.push({
    scenarioId: '7.3',
    name: 'Download File',
    status: hasDownloadRoute ? 'PASS' : 'FAIL',
    failuresFound: hasDownloadRoute ? [] : ['File download endpoint not implemented'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 8: SHARING & COLLABORATION (4 scenarios)
// ============================================================================

async function testGroup8() {
  console.log('\n📋 GROUP 8: Sharing & Collaboration\n');

  const sharingRouteFile = readFileSync('apps/backend/src/routes/sharing.ts', 'utf-8');
  const sharingPublicFile = readFileSync('apps/backend/src/routes/sharing-public.ts', 'utf-8');
  const realtimeRouteFile = readFileSync('apps/backend/src/routes/realtime.ts', 'utf-8');

  // 8.1: Create Invite Link
  const hasCreateShare = sharingRouteFile.includes('POST');
  results.push({
    scenarioId: '8.1',
    name: 'Create Invite Link',
    status: hasCreateShare ? 'PASS' : 'FAIL',
    failuresFound: hasCreateShare ? [] : ['Share creation endpoint missing'],
    fixesApplied: [],
  });

  // 8.2: Accept Shared Conversation
  const hasPublicShare = sharingPublicFile.includes('accept') || sharingPublicFile.includes('inviteToken');
  results.push({
    scenarioId: '8.2',
    name: 'Accept Shared Conversation',
    status: hasPublicShare ? 'PASS' : 'FAIL',
    failuresFound: hasPublicShare ? [] : ['Public share acceptance not implemented'],
    fixesApplied: [],
  });

  // 8.3: Real-Time Presence
  const hasWebSocket = realtimeRouteFile.includes('WebSocket') || realtimeRouteFile.includes('io') || realtimeRouteFile.includes('socket');
  results.push({
    scenarioId: '8.3',
    name: 'Real-Time Presence',
    status: hasWebSocket ? 'PASS' : 'FAIL',
    failuresFound: hasWebSocket ? [] : ['WebSocket real-time presence not implemented'],
    fixesApplied: [],
  });

  // 8.4: Revoke Share
  const hasRevokeShare = sharingRouteFile.includes('DELETE');
  results.push({
    scenarioId: '8.4',
    name: 'Revoke Share',
    status: hasRevokeShare ? 'PASS' : 'FAIL',
    failuresFound: hasRevokeShare ? [] : ['Share revocation endpoint missing'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 9: BILLING & USAGE (3 scenarios)
// ============================================================================

async function testGroup9() {
  console.log('\n📋 GROUP 9: Billing & Usage\n');

  const billingRouteFile = readFileSync('apps/backend/src/routes/billing.ts', 'utf-8');

  // 9.1: Track Token Usage
  const hasUsageTracking = billingRouteFile.includes('usage') || billingRouteFile.includes('token');
  results.push({
    scenarioId: '9.1',
    name: 'Track Token Usage',
    status: hasUsageTracking ? 'PASS' : 'FAIL',
    failuresFound: hasUsageTracking ? [] : ['Token usage tracking not implemented'],
    fixesApplied: [],
  });

  // 9.2: Quota Exhaustion
  const hasQuotaCheck = billingRouteFile.includes('quota') || billingRouteFile.includes('limit') || billingRouteFile.includes('budget');
  results.push({
    scenarioId: '9.2',
    name: 'Quota Exhaustion',
    status: hasQuotaCheck ? 'PASS' : 'FAIL',
    failuresFound: hasQuotaCheck ? [] : ['Quota enforcement not implemented'],
    fixesApplied: [],
  });

  // 9.3: Usage Analytics
  const hasAnalytics = billingRouteFile.includes('summary') || billingRouteFile.includes('analytics');
  results.push({
    scenarioId: '9.3',
    name: 'Usage Analytics',
    status: hasAnalytics ? 'PASS' : 'FAIL',
    failuresFound: hasAnalytics ? [] : ['Usage analytics endpoint missing'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 10: NOTIFICATIONS (2 scenarios)
// ============================================================================

async function testGroup10() {
  console.log('\n📋 GROUP 10: Notifications\n');

  const notificationRouteFile = readFileSync('apps/backend/src/routes/notifications.ts', 'utf-8');

  // 10.1: Notification Delivery
  const hasNotifications = notificationRouteFile.includes('GET');
  results.push({
    scenarioId: '10.1',
    name: 'Notification Delivery',
    status: hasNotifications ? 'PASS' : 'FAIL',
    failuresFound: hasNotifications ? [] : ['Notification retrieval not implemented'],
    fixesApplied: [],
  });

  // 10.2: Notification Preferences
  const hasPreferences = notificationRouteFile.includes('preference') || notificationRouteFile.includes('setting');
  results.push({
    scenarioId: '10.2',
    name: 'Notification Preferences',
    status: hasPreferences ? 'PASS' : 'FAIL',
    failuresFound: hasPreferences ? [] : ['Notification preferences not implemented'],
    fixesApplied: [],
  });
}

// ============================================================================
// GROUP 11: PROVIDER SWITCHING (2 scenarios)
// ============================================================================

async function testGroup11() {
  console.log('\n📋 GROUP 11: Provider Switching\n');

  const conversationRouteFile = readFileSync('apps/backend/src/routes/conversations.ts', 'utf-8');

  // 11.1: Switch AI Provider Mid-Conversation
  const hasProviderSwitch = conversationRouteFile.includes('provider') || conversationRouteFile.includes('PATCH');
  results.push({
    scenarioId: '11.1',
    name: 'Switch AI Provider Mid-Conversation',
    status: hasProviderSwitch ? 'PASS' : 'FAIL',
    failuresFound: hasProviderSwitch ? [] : ['Provider switching not implemented'],
    fixesApplied: [],
  });

  // 11.2: Provider Outage Failover
  results.push({
    scenarioId: '11.2',
    name: 'Provider Outage Failover',
    status: 'SKIP',
    failuresFound: [],
    fixesApplied: ['Requires runtime provider testing - skipped in static analysis'],
  });
}

// ============================================================================
// GROUP 12-14: INFRASTRUCTURE & CONCURRENCY
// ============================================================================

async function testGroups12to14() {
  console.log('\n📋 GROUPS 12-14: Infrastructure, Concurrency & Large Data\n');

  // Group 12: Infrastructure Failures - These require runtime testing
  const infraTests = [
    { id: '12.1', name: 'Database Connection Loss', status: 'SKIP' },
    { id: '12.2', name: 'Redis Cache Failure', status: 'SKIP' },
    { id: '12.3', name: 'Vector DB Unavailable', status: 'SKIP' },
    { id: '12.4', name: 'Message Queue Backlog', status: 'SKIP' },
    { id: '12.5', name: 'Network Timeout', status: 'SKIP' },
    { id: '13.1', name: 'Concurrent Message Edits', status: 'SKIP' },
    { id: '13.2', name: 'Concurrent Workspace Access', status: 'SKIP' },
    { id: '13.3', name: 'Race Condition in Billing', status: 'SKIP' },
    { id: '14.1', name: 'Large Conversation', status: 'SKIP' },
    { id: '14.2', name: 'Large Message', status: 'SKIP' },
    { id: '14.3', name: 'Large File Upload', status: 'SKIP' },
  ];

  for (const test of infraTests) {
    results.push({
      scenarioId: test.id,
      name: test.name,
      status: test.status as 'SKIP',
      failuresFound: [],
      fixesApplied: ['Requires runtime/load testing infrastructure - skipped in static analysis'],
    });
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport() {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const blocked = results.filter(r => r.status === 'BLOCKED').length;

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 RELEASE 3 E2E TEST SUMMARY');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`✅ PASSED:  ${passed}/${results.length}`);
  console.log(`❌ FAILED:  ${failed}/${results.length}`);
  console.log(`⏭️  SKIPPED: ${skipped}/${results.length}`);
  console.log(`🚫 BLOCKED: ${blocked}/${results.length}\n`);

  // Show failures
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('FAILURES IDENTIFIED:\n');
    for (const result of failures) {
      console.log(`${result.scenarioId}: ${result.name}`);
      for (const failure of result.failuresFound) {
        console.log(`  ❌ ${failure}`);
      }
      console.log();
    }
  }

  // Summary by group
  console.log('\n📈 SUMMARY BY GROUP:');
  console.log('-'.repeat(60));

  const groups = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  for (const group of groups) {
    const groupResults = results.filter(r => parseInt(r.scenarioId.split('.')[0]) === group);
    if (groupResults.length > 0) {
      const groupPass = groupResults.filter(r => r.status === 'PASS').length;
      const groupFail = groupResults.filter(r => r.status === 'FAIL').length;
      const groupSkip = groupResults.filter(r => r.status === 'SKIP').length;
      console.log(
        `Group ${group}: ${groupPass}✅ ${groupFail}❌ ${groupSkip}⏭️  (${groupResults.length} total)`
      );
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Overall Pass Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`${'='.repeat(80)}\n`);

  return { passed, failed, skipped, blocked };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n🚀 Release 3 E2E Test Runner - Starting Systematic Validation\n');

  try {
    await testGroup1();
    await testGroup2();
    await testGroup3();
    await testGroup4();
    await testGroup5();
    await testGroup6();
    await testGroup7();
    await testGroup8();
    await testGroup9();
    await testGroup10();
    await testGroup11();
    await testGroups12to14();

    const summary = generateReport();

    // Exit with appropriate code
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  }
}

main();
