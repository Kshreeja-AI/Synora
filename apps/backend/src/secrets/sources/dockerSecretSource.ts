import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { ISecretSource } from '../interfaces/secretSource';
import { SecretSourceKind } from '../types';

/**
 * Docker (Compose `secrets:` blocks and Swarm secrets) mounts each secret
 * as its own file under /run/secrets/<name>, containing exactly the
 * secret value. This is the standard convention — see
 * https://docs.docker.com/compose/how-tos/use-secrets/ — and requires no
 * SDK or API call, just reading the file.
 */
export class DockerSecretSource implements ISecretSource {
  readonly kind: SecretSourceKind = 'docker';

  constructor(private readonly mountRoot = '/run/secrets') {}

  isAvailable(): boolean {
    return existsSync(this.mountRoot);
  }

  async read(key: string): Promise<string | undefined> {
    const filePath = path.join(this.mountRoot, key);
    if (!existsSync(filePath)) {
      return undefined;
    }
    const raw = await readFile(filePath, 'utf-8');
    return raw.trimEnd();
  }
}
