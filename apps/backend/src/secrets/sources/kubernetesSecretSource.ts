import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { ISecretSource } from '../interfaces/secretSource';
import { SecretSourceKind } from '../types';

/**
 * Kubernetes Secrets, when mounted as a volume, appear as one file per
 * key under the configured mountPath — same file-per-key convention as
 * Docker, just a different default path. See
 * infrastructure/k8s/secret.example.yaml for the manifest + volumeMount
 * that produces this layout.
 *
 * `KUBERNETES_SERVICE_HOST` is injected by the Kubernetes API server into
 * every pod automatically, so it's a reliable "are we running in a
 * cluster" signal independent of whether the mount path happens to exist
 * yet.
 */
export class KubernetesSecretSource implements ISecretSource {
  readonly kind: SecretSourceKind = 'kubernetes';

  constructor(
    private readonly mountPath = '/var/run/secrets/synora',
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  isAvailable(): boolean {
    return Boolean(this.env.KUBERNETES_SERVICE_HOST) || existsSync(this.mountPath);
  }

  async read(key: string): Promise<string | undefined> {
    const filePath = path.join(this.mountPath, key);
    if (!existsSync(filePath)) {
      return undefined;
    }
    const raw = await readFile(filePath, 'utf-8');
    return raw.trimEnd();
  }
}
