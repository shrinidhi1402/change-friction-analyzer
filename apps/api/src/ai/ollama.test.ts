import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText } from './ollama.js';
import { config } from '../config.js';

describe('ollama service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates text with think:false by default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 'Generated response' }),
    } as Response);

    const result = await generateText('Hello');
    expect(result).toBe('Generated response');
    expect(fetch).toHaveBeenCalledWith(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: 'Hello',
        stream: false,
        think: false,
      }),
    });
  });

  it('sends json format and speed options when specified', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '{"key":"value"}' }),
    } as Response);

    const result = await generateText('Hello', { json: true, numPredict: 256, numCtx: 1024 });
    expect(result).toBe('{"key":"value"}');
    expect(fetch).toHaveBeenCalledWith(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: 'Hello',
        stream: false,
        think: false,
        format: 'json',
        options: { num_predict: 256, num_ctx: 1024 },
      }),
    });
  });

  it('throws an error if Ollama is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('fetch failed'));

    await expect(generateText('Hello')).rejects.toThrow('Failed to generate text from Ollama: fetch failed');
  });

  it('throws an error if Ollama returns a non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(generateText('Hello')).rejects.toThrow('Failed to generate text from Ollama: Ollama API error: 500 Internal Server Error');
  });
});
