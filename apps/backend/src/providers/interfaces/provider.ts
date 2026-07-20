/**
 * Base contract every Synora provider implements, regardless of capability
 * (image, video, audio, or future types like LLM/voice/embedding/OCR).
 * Business logic and routes must depend only on this and the capability
 * interfaces in this folder — never on a concrete provider class.
 */
export enum ProviderName {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  REPLICATE = 'replicate',
  RUNWAY = 'runway',
  SYNTHESIA = 'synthesia',
}

export interface IProvider {
  readonly name: ProviderName;
}
