/**
 * Model-level capability negotiation.
 *
 * The rule under test is one sentence: a capability is real only when the
 * MODEL claims it and SYNORA implements it for that provider. Every case
 * below is a way that conjunction can be got wrong — and each wrong answer
 * shows a user a badge promising something no request can deliver.
 */

import { describe, it, expect } from 'vitest';
import {
  negotiateModelSupport,
  modelCatalogGaps,
  getModelsForProvider,
  type ModelCard,
} from '../models';

const TOOL_MODEL: ModelCard = {
  id: 'm1',
  label: 'M1',
  description: 'test',
  contextWindow: 1000,
  capabilities: { toolUse: true, streaming: true, vision: true },
};

describe('negotiateModelSupport', () => {
  it('grants tool calling only when the model AND the adapter both do it', () => {
    const supported = negotiateModelSupport(TOOL_MODEL, 'anthropic', [
      'text-generation',
      'tool-calling',
    ]);
    expect(supported.toolCalling).toBe(true);
  });

  it('refuses tool calling for a capable model behind an adapter that cannot ask', () => {
    // Gemini's models really do support tool calling; Synora's Gemini
    // adapter really cannot request one. Badging the vendor claim here
    // would promise something no request can deliver.
    const negotiated = negotiateModelSupport(TOOL_MODEL, 'gemini', ['text-generation']);
    expect(negotiated.toolCalling).toBe(false);
  });

  it('refuses tool calling for a model that does not claim it, even on a capable adapter', () => {
    const plainModel: ModelCard = { ...TOOL_MODEL, capabilities: { streaming: true } };
    const negotiated = negotiateModelSupport(plainModel, 'openai', [
      'text-generation',
      'tool-calling',
    ]);
    expect(negotiated.toolCalling).toBe(false);
  });

  it('reports the same model differently through two providers', () => {
    // The limit is the adapter, not the model — so one model card can be
    // usable through one provider and not another, and the catalog must
    // say so rather than picking one answer for both.
    const viaOpenAI = negotiateModelSupport(TOOL_MODEL, 'openai', [
      'text-generation',
      'tool-calling',
    ]);
    const viaBedrock = negotiateModelSupport(TOOL_MODEL, 'bedrock', ['text-generation']);
    expect(viaOpenAI.toolCalling).toBe(true);
    expect(viaBedrock.toolCalling).toBe(false);
  });

  it('grants streaming only where a streaming adapter exists', () => {
    // Streaming is served by a separate stack; being a registered text
    // provider says nothing about it.
    expect(negotiateModelSupport(TOOL_MODEL, 'anthropic', []).streaming).toBe(true);
    expect(negotiateModelSupport(TOOL_MODEL, 'together', []).streaming).toBe(false);
  });

  it('never claims vision, because no request can carry an image today', () => {
    // The model card says vision: true and that is accurate about the
    // model. Synora still has no field to put an image in.
    expect(TOOL_MODEL.capabilities.vision).toBe(true);
    expect(negotiateModelSupport(TOOL_MODEL, 'openai', ['text-generation']).vision).toBe(false);
  });
});

describe('model catalog integrity', () => {
  it('has no provider without models and no catalog key without a provider', () => {
    // `azure-openai` was keyed as `azure`, so a configured Azure deployment
    // rendered as a provider with nothing selectable — a silent failure a
    // picker cannot report. This assertion is what makes it loud.
    expect(modelCatalogGaps()).toEqual({
      providersWithoutModels: [],
      orphanedCatalogKeys: [],
    });
  });

  it('serves Azure OpenAI models under the id the registry actually uses', () => {
    expect(getModelsForProvider('azure-openai').length).toBeGreaterThan(0);
    expect(getModelsForProvider('azure')).toHaveLength(0);
  });
});
