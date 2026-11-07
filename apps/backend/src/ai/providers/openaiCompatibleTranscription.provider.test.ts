/**
 * Speech-to-text adapter, tested against a deterministic fake client. These
 * tests prove the adapter's own behaviour (parsing, limits, error mapping,
 * configuration gating). They do NOT prove any real Whisper endpoint works —
 * that needs an integration run against a live server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('../../config', () => ({ getConfig: getConfigMock }));
vi.mock('openai', () => ({
  default: class {
    constructor(public opts: { apiKey: string; baseURL: string }) {}
  },
  toFile: async (data: Buffer, name: string, opts: { type: string }) => ({ data, name, type: opts.type }),
}));

import {
  MAX_STT_AUDIO_BYTES,
  OpenAICompatibleTranscriptionProvider,
  openaiCompatibleTranscriptionDescriptor,
} from './openaiCompatibleTranscription.provider';
import { AIProviderError } from '../types';
import type OpenAI from 'openai';

function fakeClient(impl: (args: unknown) => Promise<unknown>): OpenAI {
  return { audio: { transcriptions: { create: impl } } } as unknown as OpenAI;
}

const AUDIO = { audio: Buffer.from('fake-audio'), fileName: 'a.wav', mimeType: 'audio/wav' };

describe('OpenAICompatibleTranscriptionProvider', () => {
  it('maps a verbose response to text, language, duration and segments', async () => {
    const provider = new OpenAICompatibleTranscriptionProvider(
      'stt-test',
      fakeClient(async () => ({
        text: ' namaste duniya ',
        language: 'hi',
        duration: 2.5,
        segments: [
          { start: 0, end: 1.2, text: ' namaste ' },
          { start: 1.2, end: 2.5, text: 'duniya' },
          { start: 'bad', end: 3, text: 'dropped' },
        ],
      })),
      'whisper-test'
    );
    const result = await provider.transcribe({ ...AUDIO, language: 'hi' });
    expect(result).toEqual({
      text: 'namaste duniya',
      language: 'hi',
      durationSeconds: 2.5,
      segments: [
        { startSeconds: 0, endSeconds: 1.2, text: 'namaste' },
        { startSeconds: 1.2, endSeconds: 2.5, text: 'duniya' },
      ],
      provider: 'stt-test',
      model: 'whisper-test',
    });
  });

  it('does not invent language or segments when the server omits them', async () => {
    const provider = new OpenAICompatibleTranscriptionProvider(
      'stt-test',
      fakeClient(async () => ({ text: 'hello' })),
      'm'
    );
    const result = await provider.transcribe(AUDIO);
    expect(result.language).toBeUndefined();
    expect(result.segments).toBeUndefined();
    expect(result.durationSeconds).toBeUndefined();
  });

  it('passes the language hint and per-call model override through', async () => {
    const create = vi.fn(async () => ({ text: 'x' }));
    const provider = new OpenAICompatibleTranscriptionProvider('stt-test', fakeClient(create), 'default-model');
    await provider.transcribe({ ...AUDIO, language: 'en', model: 'override-model' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'override-model', language: 'en', response_format: 'verbose_json' })
    );
  });

  it('rejects empty and oversized audio before calling the server', async () => {
    const create = vi.fn();
    const provider = new OpenAICompatibleTranscriptionProvider('stt-test', fakeClient(create), 'm');
    await expect(provider.transcribe({ ...AUDIO, audio: Buffer.alloc(0) })).rejects.toBeInstanceOf(AIProviderError);
    await expect(
      provider.transcribe({ ...AUDIO, audio: Buffer.alloc(MAX_STT_AUDIO_BYTES + 1) })
    ).rejects.toBeInstanceOf(AIProviderError);
    expect(create).not.toHaveBeenCalled();
  });

  it('wraps upstream failures in AIProviderError and treats a missing transcript as failure', async () => {
    const failing = new OpenAICompatibleTranscriptionProvider(
      'stt-test',
      fakeClient(async () => {
        throw new Error('503 upstream');
      }),
      'm'
    );
    await expect(failing.transcribe(AUDIO)).rejects.toMatchObject({
      name: 'AIProviderError',
      providerId: 'stt-test',
    });

    const noText = new OpenAICompatibleTranscriptionProvider('stt-test', fakeClient(async () => ({})), 'm');
    await expect(noText.transcribe(AUDIO)).rejects.toBeInstanceOf(AIProviderError);
  });
});

describe('openaiCompatibleTranscriptionDescriptor', () => {
  beforeEach(() => getConfigMock.mockReset());

  it('is configured only when STT_BASE_URL is set', async () => {
    getConfigMock.mockReturnValue({ ai: { sttBaseUrl: undefined, sttModel: 'm' } });
    expect(await openaiCompatibleTranscriptionDescriptor.isConfigured()).toBe(false);
    getConfigMock.mockReturnValue({ ai: { sttBaseUrl: 'http://stt.local/v1', sttModel: 'm' } });
    expect(await openaiCompatibleTranscriptionDescriptor.isConfigured()).toBe(true);
  });

  it('refuses to create a provider without a base URL', async () => {
    getConfigMock.mockReturnValue({ ai: { sttBaseUrl: undefined, sttModel: 'm' } });
    await expect(openaiCompatibleTranscriptionDescriptor.create()).rejects.toThrow(/STT_BASE_URL/);
  });
});
