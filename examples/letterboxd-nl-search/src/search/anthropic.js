'use strict';

// Anthropic (Claude) backend: SEARCH_PROVIDER=anthropic, ANTHROPIC_API_KEY, optional LLM_MODEL
// (default claude-haiku-5-5: fast and cheap enough for a search box).
// Structured outputs (output_config.format) make the reply valid JSON for FILM_LIST_SCHEMA.
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs

const Anthropic = require('@anthropic-ai/sdk');

/**
 * @param {{ apiKey: string, model: string, timeoutMs: number, client?: any }} options  `client` replaces the SDK client in tests.
 * @returns {import('./llm').Provider}
 */
function createAnthropicProvider({ apiKey, model, timeoutMs, client }) {
  const anthropic = client || new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  return {
    name: 'anthropic',
    async suggest({ system, prompt, schema }) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: prompt }],
        // Low effort: a quick list of titles, not deep reasoning.
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      });
      if (response.stop_reason === 'refusal') throw new Error('the model declined this search');
      if (response.stop_reason === 'max_tokens') throw new Error('the reply was cut off (max_tokens)');
      const text = response.content.find((block) => block.type === 'text');
      if (!text) throw new Error('the reply had no text');
      return JSON.parse(text.text);
    },
  };
}

module.exports = { createAnthropicProvider };
