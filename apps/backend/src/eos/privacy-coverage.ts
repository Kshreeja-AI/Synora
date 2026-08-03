import { defaultRedactionRules } from './redaction.js';
import { recordGateMeasurement } from './launch-gates.js';

/**
 * Measures whether personal data is actually redacted on every path that
 * emits it — by running sensitive data through the real code, not by
 * checking that the redaction module works.
 *
 * WHY THE DISTINCTION IS THE WHOLE POINT. The redaction module has been
 * thoroughly tested since it was written, and that told us nothing about
 * whether the export worker used it. It did not: seven of eight sensitive
 * types leaked from a path that had its own weaker copy of the patterns.
 * A tested redactor and a redacted system are different claims, and only
 * the second one protects a customer.
 *
 * SO THIS PROBES RATHER THAN INSPECTS. Each declared path supplies a probe
 * that pushes known sensitive values through the real function and returns
 * what that function would emit. The audit then asks whether anything
 * sensitive survived. A path cannot pass by asserting it is safe; it passes
 * only by demonstrably not leaking.
 *
 * WHAT IT CANNOT SEE, stated rather than implied: a path nobody declared.
 * The registry is maintained by hand, so this measures declared coverage,
 * and the count of declared paths is reported alongside the result so a
 * high score on a short list is visible for what it is.
 */

export interface EgressPath {
  id: string;
  /** What leaves the system here, in plain terms. */
  description: string;
  /**
   * Runs the real emission path with the supplied sensitive text and
   * returns exactly what would leave the system.
   */
  probe: (sensitiveInput: string) => Promise<string> | string;
}

export interface PathResult {
  id: string;
  description: string;
  /** True only when nothing sensitive survived the real path. */
  redacted: boolean;
  /** What leaked, when something did. Categories only — never the values. */
  leakedTypes: string[];
  /** Set when the probe itself failed; the path is not counted as passing. */
  error?: string;
}

export interface PrivacyCoverageResult {
  paths: PathResult[];
  declaredPaths: number;
  redactedPaths: number;
  /** Percentage of declared paths that demonstrably redact. */
  coveragePercent: number;
  /**
   * Named so a perfect score on a short registry is not mistaken for a
   * perfect score on the system.
   */
  limitation: string;
}

/**
 * Values chosen to span the redaction rules, including the regional
 * identifiers a Western-centric probe would miss — an earlier phone pattern
 * passed US and UK numbers and failed Indian ones.
 */
export const SENSITIVE_PROBE_INPUT = [
  'email keshav@synora.ai',
  'card 4111111111111111',
  'phone +91 98765 43210',
  'phone +1 (555) 123-4567',
  'PAN ABCDE1234F',
  'Aadhaar 1234 5678 9012',
  'key sk-live-abcdefghijklmnopqrstuvwxyz',
  'bearer Bearer abcdefghijklmnopqrstuvwxyz123456',
  'ip 192.168.10.24',
].join(' | ');

/**
 * Which rules still match after a path has done its redacting. Written
 * against the rules directly rather than using `containsSensitive`, which
 * answers only yes-or-no — and "something leaked" is far less useful to a
 * reader than "the card and phone patterns leaked".
 */
function findLeakedTypes(text: string): string[] {
  return defaultRedactionRules
    .filter((rule) => new RegExp(rule.pattern.source, rule.pattern.flags).test(text))
    .map((rule) => rule.name);
}

const paths = new Map<string, EgressPath>();

/**
 * Declares a path that emits data outside the system. Called by the module
 * that owns the path, so declaring and implementing stay together.
 */
export function declareEgressPath(path: EgressPath): void {
  paths.set(path.id, path);
}

export function resetEgressPaths(): void {
  paths.clear();
}

export function listEgressPaths(): string[] {
  return [...paths.keys()].sort();
}

export async function auditPrivacyCoverage(): Promise<PrivacyCoverageResult> {
  const results: PathResult[] = [];

  for (const path of paths.values()) {
    try {
      const emitted = await path.probe(SENSITIVE_PROBE_INPUT);
      const found = findLeakedTypes(emitted);
      results.push({
        id: path.id,
        description: path.description,
        redacted: found.length === 0,
        // Categories, never the matched values — a privacy report that
        // quoted the leak would itself be a leak.
        leakedTypes: found,
      });
    } catch (err) {
      results.push({
        id: path.id,
        description: path.description,
        // A probe that throws proves nothing, so it is not a pass.
        redacted: false,
        leakedTypes: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const redactedPaths = results.filter((r) => r.redacted).length;

  return {
    paths: results,
    declaredPaths: results.length,
    redactedPaths,
    coveragePercent: results.length > 0 ? (redactedPaths / results.length) * 100 : 0,
    limitation:
      `Measured across ${results.length} declared egress path(s). A path nobody declared is not ` +
      `covered by this audit, so this is declared coverage rather than proof that the system has ` +
      `no other way of emitting data.`,
  };
}

/**
 * Runs the audit and records it against the privacy launch gate. Refuses to
 * record anything when no path is declared — a 0-of-0 audit is vacuous, and
 * reporting it as 0% would read as a failure rather than as an absence.
 */
export async function measurePrivacyGate(): Promise<PrivacyCoverageResult | null> {
  const result = await auditPrivacyCoverage();
  if (result.declaredPaths === 0) return null;

  recordGateMeasurement({
    gateId: 'privacy-tests',
    value: result.coveragePercent,
    source: `privacy coverage audit across ${result.declaredPaths} declared egress path(s)`,
    measuredAt: Date.now(),
    sampleSize: result.declaredPaths,
  });

  return result;
}
