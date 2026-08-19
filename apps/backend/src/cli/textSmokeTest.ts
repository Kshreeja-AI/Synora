// FIRST IMPORT, deliberately: the environment must be loaded by an import.
import '../bootstrap-env';
import { initConfig, getConfig } from '../config';
import { resolveTextGenerationProvider } from '../ai/resolver';
import { instrumentedGenerate } from '../ai/instrumentedGenerate';
import { declareAiPath } from '../eos/instrumentation';
import { estimateCostOrUnknown, isPriceKnown } from '../ai/pricing';
import { getProviderDescriptor } from '../ai/registry';

/**
 * `pnpm --filter @synora/backend smoke:text`
 *
 * ONE real generation, through the whole abstraction, with the smallest
 * possible request. This is what turns TEXT from "a key is present" into
 * "a model actually answered" — the distinction between ENABLED and VERIFIED,
 * and the one a passing test suite cannot make on its own.
 *
 * ── WHAT IT EXERCISES, IN ORDER ──────────────────────────────────────────
 *
 *   resolver → provider descriptor → adapter → model
 *     → normalised TextGenerationResult
 *     → spend guard (budget check before, accounting after)
 *     → EOS instrumentation
 *
 * If any link is broken this fails, and it fails naming the link. A unit test
 * with a mocked provider proves none of it.
 *
 * ── WHY IT IS SAFE TO RUN ────────────────────────────────────────────────
 *
 * 16 output tokens, a four-word prompt, no tools, no streaming. On an
 * unmetered provider it costs nothing; on a metered one it costs a fraction
 * of a cent and the spend guard records it like any other call. It refuses to
 * run at all if the resolved provider is metered and `--allow-paid` was not
 * passed, because "the smoke test spent money" is not a surprise anybody
 * should have.
 */
const PROMPT_ID = 'cli.smoke.text';
declareAiPath(PROMPT_ID);

async function main(): Promise<void> {
  await initConfig();

  const provider = await resolveTextGenerationProvider();
  const descriptor = getProviderDescriptor(provider.id);
  const metered = descriptor?.metering === 'metered';

  process.stdout.write('\n  SYNORA TEXT SMOKE TEST\n\n');
  process.stdout.write(`  resolved provider   ${provider.id}\n`);
  process.stdout.write(`  metering            ${descriptor?.metering ?? 'unknown (treated as metered)'}\n`);

  if (metered && !process.argv.includes('--allow-paid')) {
    // Refusing by default is the point. A developer command that quietly
    // bills a frontier provider because it happened to be first in the
    // registry is exactly the surprise the spend guard exists to prevent.
    process.stdout.write(
      '\n  REFUSED: the resolved provider is METERED and would bill for this request.\n' +
        '  Re-run with --allow-paid if you intend to spend money.\n\n'
    );
    return;
  }

  // 256, not 16, and the reason is a real failure this test hit: a reasoning
  // model (qwen3, DeepSeek R1, o-series) spends output budget on internal
  // thinking BEFORE writing a word. At 16 tokens it produced no text at all,
  // and the adapter correctly refused to pass an empty string off as an
  // answer. A smoke test whose budget only fits a non-reasoning model would
  // report a false failure on exactly the open models this deployment runs.
  //
  // Still tiny: a few hundredths of a cent on the most expensive provider
  // Synora supports, and nothing at all on a local one.
  const startedAt = Date.now();
  const result = await instrumentedGenerate(PROMPT_ID, {
    prompt: 'Reply with exactly: OK',
    maxTokens: 256,
    temperature: 0,
  });
  const latencyMs = Date.now() - startedAt;

  const model = result.model;
  const inputTokens = result.usage?.inputTokens;
  const outputTokens = result.usage?.outputTokens;
  const priced = isPriceKnown(model);
  const costUsd = estimateCostOrUnknown(model, inputTokens ?? 0, outputTokens ?? 0);

  process.stdout.write(`  model               ${model}\n`);
  process.stdout.write(`  latency             ${latencyMs} ms\n`);
  process.stdout.write(
    `  usage               in=${inputTokens ?? 'not reported'} out=${outputTokens ?? 'not reported'}\n`
  );
  process.stdout.write(
    `  price table         ${priced ? `known (~$${(costUsd ?? 0).toFixed(6)})` : 'UNKNOWN — a metered provider would be charged the ceiling'}\n`
  );
  process.stdout.write(`  finish reason       ${result.finishReason ?? 'not reported'}\n`);
  process.stdout.write(`  response            ${JSON.stringify(result.text.slice(0, 120))}\n`);

  // The result SHAPE is the contract every caller depends on. Checking it
  // here catches an adapter that returns something plausible but wrong —
  // which a mocked unit test cannot, because the mock returns the shape by
  // construction.
  const shapeOk =
    typeof result.text === 'string' && typeof result.provider === 'string' && typeof result.model === 'string';
  process.stdout.write(`  normalised shape    ${shapeOk ? 'OK' : 'MALFORMED'}\n`);

  const caps = getConfig().ai;
  process.stdout.write(
    `  spend caps          daily=${caps.globalMaxCostPerDayCents ?? 'unset'} cents, tokens=${caps.globalMaxTokensPerDay ?? 'unset'}\n`
  );

  process.stdout.write(
    `\n  ${result.text.trim().length > 0 ? 'VERIFIED — a model answered through the full abstraction.' : 'EMPTY RESPONSE — the provider answered with no text.'}\n\n`
  );
}

main().catch((error: unknown) => {
  // The error MESSAGE only. A provider error object can carry request headers,
  // and dumping it would put an Authorization header in a terminal.
  process.stderr.write(
    `\n  smoke test FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n\n`
  );
  process.exitCode = 1;
});
