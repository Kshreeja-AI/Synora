/**
 * Boot-time priming of the tool-secret encryption service.
 *
 * The defect this guards: the encryption service reads process.env
 * directly (it is sync), while boot validation resolves secrets through
 * the SecretsManager chain — which also reads docker/kubernetes secret
 * FILES. Without priming, a key mounted as a file passes validation and
 * then misses at runtime. prime() closes that gap; these tests pin the
 * precedence and that a primed key genuinely encrypts and decrypts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptionService } from '../encryption.service';

const PRIMED_KEY = 'primed-master-key-resolved-from-secret-chain';
const ENV_KEY = 'env-master-key-from-process-environment-1234';

describe('EncryptionService priming', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.TOOL_SECRET_MASTER_KEY;
    delete process.env.TOOL_SECRET_MASTER_KEY;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.TOOL_SECRET_MASTER_KEY;
    else process.env.TOOL_SECRET_MASTER_KEY = savedEnv;
  });

  it('is unconfigured with neither a primed key nor the env var', () => {
    expect(new EncryptionService().isConfigured()).toBe(false);
  });

  it('a primed key configures the service and round-trips a real secret', () => {
    const service = new EncryptionService();
    service.prime(PRIMED_KEY);
    expect(service.isConfigured()).toBe(true);

    const encrypted = service.encrypt('the-actual-tool-credential');
    expect(service.decrypt(encrypted).value).toBe('the-actual-tool-credential');
  });

  it('the primed key WINS over the env var — validation and runtime must agree on one key', () => {
    process.env.TOOL_SECRET_MASTER_KEY = ENV_KEY;
    const primed = new EncryptionService();
    primed.prime(PRIMED_KEY);

    const envOnly = new EncryptionService();

    // Same plaintext, different effective keys: what the primed service
    // encrypts, the env-only service must NOT be able to decrypt.
    const encrypted = primed.encrypt('cross-key-check');
    expect(() => envOnly.decrypt(encrypted)).toThrow();
  });

  it('priming undefined is a no-op and the env fallback still works — the development path', () => {
    process.env.TOOL_SECRET_MASTER_KEY = ENV_KEY;
    const service = new EncryptionService();
    service.prime(undefined);
    const encrypted = service.encrypt('dev-path');
    expect(service.decrypt(encrypted).value).toBe('dev-path');
  });
});
