/**
 * Provider-native tool calling: the wire mapping, in both directions, for
 * the two adapter families that implement it.
 *
 * No provider is contacted. Each test asserts what Synora SENDS (that the
 * vendor's own spelling is produced correctly) or what Synora MAKES of what
 * it receives (that a vendor's reply becomes one provider-agnostic shape).
 * These two directions are where a tool loop actually breaks: a mis-mapped
 * tool-call id or a dropped result makes the model answer a question nobody
 * asked, and the provider is the only place that can go wrong.
 */

import { describe, it, expect, vi } from 'vitest';
import { AnthropicTextProvider } from './anthropic.provider';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';
import { AIProviderError, type AIToolDefinition } from '../types';

const WEATHER_TOOL: AIToolDefinition = {
  name: 'get_weather',
  description: 'Look up the current weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

function anthropicClientReturning(content: unknown[]) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content,
        model: 'claude-sonnet-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  };
}

function openaiClientReturning(message: Record<string, unknown>) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message, finish_reason: 'tool_calls' }],
          model: 'gpt-4o',
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      },
    },
  };
}

describe('Anthropic tool calling', () => {
  it('sends tools in Anthropic spelling (input_schema, not parameters)', async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'ok' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({ prompt: 'weather in Paris?', tools: [WEATHER_TOOL] });

    const sent = client.messages.create.mock.calls[0][0];
    expect(sent.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Look up the current weather for a city.',
        input_schema: WEATHER_TOOL.inputSchema,
      },
    ]);
  });

  it("maps toolChoice 'required' to Anthropic's 'any'", async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'ok' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({
      prompt: 'weather?',
      tools: [WEATHER_TOOL],
      toolChoice: 'required',
    });

    expect(client.messages.create.mock.calls[0][0].tool_choice).toEqual({ type: 'any' });
  });

  it("sends no tools at all for toolChoice 'none'", async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'ok' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({
      prompt: 'just talk',
      tools: [WEATHER_TOOL],
      toolChoice: 'none',
    });

    const sent = client.messages.create.mock.calls[0][0];
    expect(sent.tools).toBeUndefined();
    expect(sent.tool_choice).toBeUndefined();
  });

  it('reads tool_use blocks back as toolCalls, keeping the provider id verbatim', async () => {
    const client = anthropicClientReturning([
      { type: 'text', text: 'Let me check that.' },
      { type: 'tool_use', id: 'toolu_abc123', name: 'get_weather', input: { city: 'Paris' } },
    ]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    const result = await provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL] });

    // Text and a tool call in the same turn is normal, not a contradiction.
    expect(result.text).toBe('Let me check that.');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_abc123', name: 'get_weather', input: { city: 'Paris' } },
    ]);
  });

  it('leaves toolCalls ABSENT when the model answered in prose', async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'It is sunny.' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    const result = await provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL] });

    // Absent, not an empty array: "wants nothing run" must not need a
    // length check to distinguish from "no tools were offered".
    expect(result.toolCalls).toBeUndefined();
    expect('toolCalls' in result).toBe(false);
  });

  it('replays a full tool round trip as Anthropic content blocks', async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'It is 18C.' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({
      // Empty prompt: the caller is returning tool output, not new human input.
      prompt: '',
      tools: [WEATHER_TOOL],
      messages: [
        { role: 'user', content: 'weather in Paris?' },
        {
          role: 'assistant',
          content: 'Checking.',
          toolCalls: [{ id: 'toolu_abc123', name: 'get_weather', input: { city: 'Paris' } }],
        },
        {
          role: 'user',
          content: '',
          toolResults: [{ toolCallId: 'toolu_abc123', content: '18C, clear' }],
        },
      ],
    });

    const sent = client.messages.create.mock.calls[0][0];
    // Three turns in, three turns out — no invented empty user turn.
    expect(sent.messages).toHaveLength(3);
    expect(sent.messages[1].content).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'toolu_abc123', name: 'get_weather', input: { city: 'Paris' } },
    ]);
    expect(sent.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_abc123', content: '18C, clear' },
    ]);
  });

  it('marks a failed tool result so the model can adapt', async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'Sorry.' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({
      prompt: '',
      messages: [
        {
          role: 'user',
          content: '',
          toolResults: [{ toolCallId: 'toolu_x', content: 'timed out', isError: true }],
        },
      ],
    });

    expect(client.messages.create.mock.calls[0][0].messages[0].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_x',
      content: 'timed out',
      is_error: true,
    });
  });
});

describe('OpenAI-compatible tool calling', () => {
  it('sends tools in OpenAI spelling (function/parameters)', async () => {
    const client = openaiClientReturning({ content: 'ok' });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    await provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL], toolChoice: 'auto' });

    const sent = client.chat.completions.create.mock.calls[0][0];
    expect(sent.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Look up the current weather for a city.',
          parameters: WEATHER_TOOL.inputSchema,
        },
      },
    ]);
    expect(sent.tool_choice).toBe('auto');
  });

  it('parses the JSON-string arguments OpenAI sends into a real object', async () => {
    const client = openaiClientReturning({
      content: null,
      tool_calls: [
        {
          id: 'call_abc',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    const result = await provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL] });

    expect(result.toolCalls).toEqual([
      { id: 'call_abc', name: 'get_weather', input: { city: 'Paris' } },
    ]);
    // Same provider-agnostic shape Anthropic produces, from a different wire format.
    expect(result.text).toBe('');
  });

  it('refuses to guess at unparseable arguments, naming the tool', async () => {
    const client = openaiClientReturning({
      content: null,
      tool_calls: [
        {
          id: 'call_bad',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Par' },
        },
      ],
    });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    // Running a tool with half-understood arguments is worse than failing.
    await expect(
      provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL] })
    ).rejects.toThrow(AIProviderError);
    await expect(
      provider.generateText({ prompt: 'weather?', tools: [WEATHER_TOOL] })
    ).rejects.toThrow(/get_weather.*was not run/s);
  });

  it('treats an argument-less tool call as empty input, not a failure', async () => {
    const client = openaiClientReturning({
      content: null,
      tool_calls: [
        { id: 'call_p', type: 'function', function: { name: 'ping', arguments: '' } },
      ],
    });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    const result = await provider.generateText({ prompt: 'ping' });
    expect(result.toolCalls).toEqual([{ id: 'call_p', name: 'ping', input: {} }]);
  });

  it('expands each tool result into its own role:tool message', async () => {
    const client = openaiClientReturning({ content: 'It is 18C.' });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    await provider.generateText({
      prompt: '',
      messages: [
        { role: 'user', content: 'weather in Paris and Rome?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'get_weather', input: { city: 'Paris' } },
            { id: 'call_2', name: 'get_weather', input: { city: 'Rome' } },
          ],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            { toolCallId: 'call_1', content: '18C' },
            { toolCallId: 'call_2', content: '24C' },
          ],
        },
      ],
    });

    const sent = client.chat.completions.create.mock.calls[0][0];
    // 3 Synora turns -> 4 OpenAI messages: two results become two messages.
    expect(sent.messages).toHaveLength(4);
    expect(sent.messages[1]).toEqual({
      role: 'assistant',
      content: null, // never '', which OpenAI rejects beside tool_calls
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Rome"}' } },
      ],
    });
    expect(sent.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '18C' });
    expect(sent.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_2', content: '24C' });
  });

  it('tells the model a tool failed, since OpenAI has no error flag', async () => {
    const client = openaiClientReturning({ content: 'Sorry.' });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    await provider.generateText({
      prompt: '',
      messages: [
        {
          role: 'user',
          content: '',
          toolResults: [{ toolCallId: 'call_1', content: 'timed out', isError: true }],
        },
      ],
    });

    expect(client.chat.completions.create.mock.calls[0][0].messages[0].content).toBe(
      'ERROR: timed out'
    );
  });
});

describe('requests without tools are unchanged', () => {
  it('sends no tool fields to Anthropic', async () => {
    const client = anthropicClientReturning([{ type: 'text', text: 'hi' }]);
    const provider = new AnthropicTextProvider(client as never, 'claude-sonnet-5');

    await provider.generateText({ prompt: 'hello' });

    const sent = client.messages.create.mock.calls[0][0];
    expect(sent.tools).toBeUndefined();
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('sends no tool fields to OpenAI', async () => {
    const client = openaiClientReturning({ content: 'hi' });
    const provider = new OpenAICompatibleTextProvider('openai', client as never, 'gpt-4o');

    await provider.generateText({ prompt: 'hello' });

    const sent = client.chat.completions.create.mock.calls[0][0];
    expect(sent.tools).toBeUndefined();
    expect(sent.tool_choice).toBeUndefined();
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });
});
