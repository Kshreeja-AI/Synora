/**
 * Setting Synora up should not require anyone to handle a secret.
 *
 * It used to mean running `openssl rand -base64 32` three times and pasting
 * the results into the right places — the three steps most likely to be
 * skipped, mistyped, or pasted into a chat window on the way. `pnpm run
 * setup:env` does them instead. A secret no person ever handles is a secret
 * no person can mishandle.
 *
 * These tests pin the properties that make the script safe to run, and
 * safe to run TWICE — which matters more than it sounds. A generator that
 * overwrote a live JWT_SECRET would sign every user out and make every
 * stored tool credential permanently undecryptable, and it would do it to
 * whoever ran the setup command a second time.
 *
 * The behaviour was also exercised directly, in a throwaway directory:
 * three distinct 32-byte secrets written, file mode 600, a re-run leaving
 * the file byte-identical, and `--production` leaving the localhost values
 * blank instead of writing the exact values the boot gate refuses.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ENV_CATALOG,
  generatedVariables,
  suppliedRequiredVariables,
  catalogSecretNames,
  registrySecretNames,
} from '../envCatalog';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SCRIPT = readFileSync(resolve(REPO_ROOT, 'scripts/setup-env.mjs'), 'utf8');

/**
 * Names declared inside one of the script's arrays.
 *
 * Reads the whole block and pulls every `name:` out of it, rather than
 * matching a one-line entry shape. THE FIRST VERSION OF THIS DID match a
 * one-line shape and silently found two of three names, because the
 * formatter had wrapped the third across four lines. The comparison below
 * caught it — but only because it compares the full list. A test that had
 * merely asserted "we found some names" would have passed while checking
 * two thirds of the thing it claimed to check.
 */
function namesInScriptArray(arrayName: string): string[] {
  const start = SCRIPT.indexOf(`const ${arrayName} = [`);
  if (start === -1) return [];
  const block = SCRIPT.slice(start, SCRIPT.indexOf('\n];', start));
  return [...block.matchAll(/name: '([A-Z_]+)'/g)].map((m) => m[1]);
}

describe('the setup script and the catalogue agree', () => {
  it('generates exactly the variables the catalogue says are generated', () => {
    // The script duplicates the list rather than importing it, because it
    // runs BEFORE install and before TypeScript is compiled — a bootstrap
    // that imports from the thing it bootstraps is not a bootstrap. That
    // duplication is only acceptable while something proves the two agree,
    // and this is that something.
    expect(namesInScriptArray('GENERATED').sort()).toEqual(
      generatedVariables().map((v) => v.name).sort()
    );
  });

  it('reads entries the formatter has wrapped across lines', () => {
    // Pins the exact way the first version of this file was wrong. One
    // entry is multi-line today; a parser that only understands the
    // one-line shape would drop it and quietly under-check.
    expect(namesInScriptArray('GENERATED')).toContain('TOOL_SECRET_MASTER_KEY');
  });

  it('asks the person only for what the catalogue says they must supply', () => {
    const inScript = namesInScriptArray('SUPPLIED');
    const catalogue = suppliedRequiredVariables().map((v) => v.name);
    // NEXT_PUBLIC_API_URL is deliberately absent from the script: it belongs
    // to the WEBSITE's build, not to the API's settings file, and writing it
    // here would imply it can be changed by editing a file after the fact.
    for (const name of inScript) {
      expect(catalogue, `${name} is requested by the script but not catalogued`).toContain(name);
    }
    expect(inScript.length).toBeGreaterThan(0);
  });
});

describe('what the script must never do', () => {
  it('never prints a secret value — not even a prefix', () => {
    // A "safe" first few characters of a key in a terminal scrollback is
    // still part of a key. The script logs names and nothing else.
    //
    // The first version of this banned the word "value" anywhere inside a
    // console.log, and tripped on the prose "every value this script
    // manages is already set". Banning a WORD bans explanation; what has
    // to be banned is printing the things that actually hold secrets.
    const logged = [...SCRIPT.matchAll(/console\.log\(([\s\S]*?)\);/g)].map((m) => m[1]);
    for (const argument of logged) {
      for (const forbidden of ['randomBytes', 'additions', 'body', 'devDefault']) {
        expect(argument, `console.log prints ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Truncating a secret to "show a bit of it" is the usual way one ends
    // up in a log despite everyone's good intentions.
    expect(SCRIPT).not.toMatch(/\.slice\(0,\s*\d+\)/);
    expect(logged.length).toBeGreaterThan(0);
  });

  it('RUNS TWICE without changing a single byte', () => {
    // THE PROPERTY THAT MATTERS MOST HERE, and the one this file first got
    // wrong. The original test asserted the source contained the skip
    // guard — and when that guard was deleted from the loop that generates
    // secrets, the test still passed, because the identical line survives
    // in the loop below it. A structural check that matches ANYWHERE
    // proves nothing about the place it was meant to protect.
    //
    // So this runs the real script, twice, in a throwaway directory, and
    // compares the file byte for byte. Overwriting a live JWT_SECRET signs
    // every user out and makes every stored tool credential permanently
    // undecryptable — to whoever ran the setup command a second time.
    const dir = mkdtempSync(join(tmpdir(), 'synora-env-'));
    try {
      // The script resolves its target from its own location, so point it
      // at a copy inside the sandbox rather than at the repository.
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      copyFileSync(resolve(REPO_ROOT, 'scripts/setup-env.mjs'), join(dir, 'scripts/setup-env.mjs'));
      const runSandboxed = (): string => {
        execFileSync('node', [join(dir, 'scripts/setup-env.mjs')], { cwd: dir, stdio: 'pipe' });
        return readFileSync(join(dir, 'apps/backend/.env.local'), 'utf8');
      };
      const first = runSandboxed();
      const second = runSandboxed();
      expect(second).toBe(first);

      // And it really did write secrets the first time — otherwise this
      // would be comparing two empty files and calling it stability.
      for (const variable of generatedVariables()) {
        expect(first).toMatch(new RegExp(`^${variable.name}=.+$`, 'm'));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives each secret its own independent value', () => {
    // Reusing one random value across all three would look fine in the
    // file and mean a single leak compromises sessions, logins and every
    // stored tool credential at once.
    const dir = mkdtempSync(join(tmpdir(), 'synora-env-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      copyFileSync(resolve(REPO_ROOT, 'scripts/setup-env.mjs'), join(dir, 'scripts/setup-env.mjs'));
      execFileSync('node', [join(dir, 'scripts/setup-env.mjs')], { cwd: dir, stdio: 'pipe' });
      const written = readFileSync(join(dir, 'apps/backend/.env.local'), 'utf8');

      const values = generatedVariables().map((v) => {
        const match = written.match(new RegExp(`^${v.name}=(.+)$`, 'm'));
        return match?.[1] ?? '';
      });
      expect(new Set(values).size).toBe(values.length);
      // 32 bytes of base64 is 44 characters — comfortably past the
      // registry's 32-character minimum, so the generator's own output can
      // never be rejected by the secrets layer.
      for (const value of values) {
        expect(Buffer.from(value, 'base64').length).toBeGreaterThanOrEqual(32);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the file readable only by its owner', () => {
    expect(SCRIPT).toMatch(/mode: 0o600/);
    // chmod as well as mode: the mode argument does nothing when the file
    // already exists, which is precisely the re-run case.
    expect(SCRIPT).toMatch(/chmodSync\(TARGET, 0o600\)/);
  });

  it('uses real randomness, not a predictable source', () => {
    expect(SCRIPT).toMatch(/randomBytes\(spec\.bytes\)/);
    expect(SCRIPT).not.toMatch(/Math\.random/);
  });

  it('generates at least 32 bytes for every secret', () => {
    // The registry's minimum is 32 CHARACTERS; 32 bytes of base64 is 44,
    // comfortably clear. Anything less would produce a value the secrets
    // layer then rejects — a generator whose output fails validation is
    // worse than no generator.
    for (const variable of generatedVariables()) {
      expect(variable.generateBytes ?? 0).toBeGreaterThanOrEqual(32);
    }
  });
});

describe('the catalogue is honest about what it claims', () => {
  it('only calls something SECRET if the secrets registry knows it', () => {
    // A name this file calls SECRET but the registry has never heard of
    // gets NONE of the registry's protections: no rotation policy, no
    // production refusal of a leaked development value, no minimum length.
    // It would be labelled protected and be unprotected.
    const registry = new Set(registrySecretNames());
    for (const name of catalogSecretNames()) {
      expect(registry.has(name), `${name} is labelled SECRET but is not in SECRET_CATALOG`).toBe(
        true
      );
    }
  });

  it('never claims a vendor credential can be generated', () => {
    // A random string is not an account. Writing a plausible-looking fake
    // into a real settings file would be worse than leaving it blank: it
    // would fail later, somewhere else, looking like a provider outage.
    for (const variable of generatedVariables()) {
      expect(variable.name).not.toMatch(/API_KEY|TOKEN|ACCESS_KEY|DATABASE_URL/);
    }
  });

  it('says what breaks for everything it marks REQUIRED', () => {
    // "Required" with no reason is an instruction. With a consequence it is
    // an explanation, and someone can tell whether it applies to them.
    for (const variable of ENV_CATALOG.filter((v) => v.necessity === 'REQUIRED')) {
      expect(variable.consequence, `${variable.name} is REQUIRED but says nothing about why`)
        .toBeTruthy();
    }
  });

  it('keeps the list short enough to be read', () => {
    // Synora reads 161 environment variables. Listing all of them as
    // decisions turns a ten-minute setup into an afternoon, and a list
    // nobody finishes reading protects nobody. This is the subset that
    // genuinely needs a person — if it ever grows past a screenful,
    // something has been added that should have had a default.
    expect(ENV_CATALOG.length).toBeLessThanOrEqual(15);
  });

  it('is frozen — a shared catalogue must not be edited at runtime', () => {
    expect(Object.isFrozen(ENV_CATALOG)).toBe(true);
  });
});
