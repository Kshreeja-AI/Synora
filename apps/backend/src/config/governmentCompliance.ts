import { AppConfig } from './types';
import { GovernmentModeComplianceError } from './errors';
import { IHsmProvider } from '../secrets/interfaces/hsm';

/**
 * The one concrete requirement wired for "Government Mode" today: it must
 * not be running against the stub HSM. Real government/FedRAMP-style
 * deployments require key material to be HSM-backed, not
 * environment-variable-backed — StubHsmProvider throws on every
 * operation by design (see apps/backend/src/secrets/hsm/stubHsmProvider.ts),
 * so this check exists to fail startup with a clear message instead of
 * failing confusingly the first time something tries to use it.
 *
 * Everything else "Government Mode" implies (data residency, FIPS-validated
 * crypto, audit retention requirements, etc.) is a compliance/ops concern
 * documented in docs/operations/ENVIRONMENT_MANAGEMENT.md, not something
 * this function can verify in code — don't extend this into a false sense
 * of "government mode = compliant".
 */
export function assertGovernmentModeCompliance(config: AppConfig, hsm: IHsmProvider): void {
  if (!config.modes.government) return;

  if (!hsm.available) {
    throw new GovernmentModeComplianceError(
      'no HSM provider is configured (StubHsmProvider is in use). GOVERNMENT_MODE requires ' +
        'a real IHsmProvider implementation — see docs/security/SECRET_MANAGEMENT.md#future-hsm-integration.'
    );
  }
}
