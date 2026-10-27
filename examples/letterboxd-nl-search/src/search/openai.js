'use strict';

// OpenAI-compatible backend, through plain fetch (no extra dependency):
//   SEARCH_PROVIDER=openai  OPENAI_API_KEY, LLM_MODEL, optional OPENAI_BASE_URL
//   SEARCH_PROVIDER=ollama  a local Ollama (free, nothing leaves your computer), OLLAMA_URL, LLM_MODEL
// Both use POST <base>/chat/completions with a JSON-schema response_format.

/**
 * @param {{ name: string, baseUrl: string, model: string, apiKey?: string, timeoutMs: number }} options
 * @returns {import('./llm').Provider}
 */
function createOpenAiProvider({ name, baseUrl, model, apiKey, timeoutMs }) {
  return {
    name,
    async suggest({ system, prompt, schema }) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'film_list', strict: true, schema } },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // The error body can be long, and never contains the key: keep its start only.
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`${name} answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const body = await res.json();
      const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      if (typeof content !== 'string') throw new Error(`${name} returned no message`);
      return JSON.parse(content);
    },
  };
}

module.exports = { createOpenAiProvider };
