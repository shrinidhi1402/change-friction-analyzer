import { config } from '../config.js';

export interface OllamaOptions {
  json?: boolean;
  numPredict?: number;
  numCtx?: number;
}

export async function generateText(prompt: string, options?: OllamaOptions): Promise<string> {
  try {
    const body: Record<string, unknown> = {
      model: config.ollamaModel,
      prompt: prompt,
      stream: false,
      think: false,
    };

    if (options?.json) body.format = 'json';

    // Ollama options for speed control
    const ollamaOptions: Record<string, unknown> = {};
    if (options?.numPredict) ollamaOptions.num_predict = options.numPredict;
    if (options?.numCtx) ollamaOptions.num_ctx = options.numCtx;
    if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;

    const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate text from Ollama: ${error.message}`);
    }
    throw new Error('Failed to generate text from Ollama: Unknown error');
  }
}
