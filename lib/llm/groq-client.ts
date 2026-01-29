/**
 * Groq LLM client configuration
 * Uses OpenAI-compatible API with Groq's fast inference
 */

import OpenAI from 'openai';

// ============================================================================
// Configuration
// ============================================================================

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

// ============================================================================
// Client Factory
// ============================================================================

let clientInstance: OpenAI | null = null;

/**
 * Get or create the Groq client instance
 */
export function getGroqClient(): OpenAI {
  if (!clientInstance) {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      throw new Error(
        'GROQ_API_KEY environment variable is not set. ' +
        'Please add it to your .env.local file.'
      );
    }

    clientInstance = new OpenAI({
      apiKey,
      baseURL: GROQ_BASE_URL,
    });
  }

  return clientInstance;
}

/**
 * Get the default model to use
 */
export function getDefaultModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

// ============================================================================
// Types
// ============================================================================

export interface LLMResponse {
  sql: string | null;
  assumptions?: string;
  error?: string;
}

// ============================================================================
// Chat Completion
// ============================================================================

/**
 * Generate a chat completion from Groq
 */
export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<LLMResponse> {
  const client = getGroqClient();
  const model = options.model || getDefaultModel();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return { sql: null, error: 'Empty response from LLM' };
    }

    // Parse JSON response
    try {
      const parsed = JSON.parse(content);
      return {
        sql: parsed.sql || null,
        assumptions: parsed.assumptions,
        error: parsed.error,
      };
    } catch (parseError) {
      console.error('[LLM] Failed to parse response:', content);
      return { sql: null, error: 'Failed to parse LLM response' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LLM] API error:', message);
    return { sql: null, error: `LLM API error: ${message}` };
  }
}
