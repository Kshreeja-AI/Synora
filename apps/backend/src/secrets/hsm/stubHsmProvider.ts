import { IHsmProvider, HsmNotConfiguredError } from '../interfaces/hsm';

/**
 * The only IHsmProvider implementation today. Every method throws — this
 * is intentional so that any code path accidentally depending on HSM
 * behavior fails loudly in development rather than silently falling back
 * to something insecure.
 */
export class StubHsmProvider implements IHsmProvider {
  readonly available = false;

  async encrypt(): Promise<Buffer> {
    throw new HsmNotConfiguredError('encrypt');
  }

  async decrypt(): Promise<Buffer> {
    throw new HsmNotConfiguredError('decrypt');
  }

  async sign(): Promise<Buffer> {
    throw new HsmNotConfiguredError('sign');
  }

  async getPublicKey(): Promise<Buffer> {
    throw new HsmNotConfiguredError('getPublicKey');
  }
}
