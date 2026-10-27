'use strict';

// Settings, read once from environment variables (.env with Docker Compose).
// Every variable is documented in .env.example. API keys are read here and never logged.

const path = require('node:path');

const PROVIDERS = ['keyword', 'anthropic', 'openai', 'ollama'];

/** Default model per provider. OpenAI-compatible servers need LLM_MODEL. */
const DEFAULT_MODELS = { anthropic: 'claude-haiku-5-5', ollama: 'llama3.2' };

/**
 * @typedef {object} Config
 * @property {'keyword'|'anthropic'|'openai'|'ollama'} provider  What actually runs (keyword when the chosen LLM is not usable).
 * @property {string} requestedProvider
 * @property {string} [model]
 * @property {string} [apiKey]
 * @property {string} [baseUrl]       OpenAI-compatible endpoint (openai, ollama)
 * @property {string} letterboxdDir
 * @property {boolean} hideWatched
 * @property {boolean} tasteHints
 * @property {number} maxResults
 * @property {number} timeoutMs
 * @property {string[]} problems     Why the chosen provider is not usable, if so.
 */

/**
 * @param {string|undefined} value
 * @param {boolean} fallback
 */
function bool(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function int(value, fallback, min, max) {
  const n = Number.parseInt(value || '', 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
function loadConfig(env = process.env) {
  const requested = (env.SEARCH_PROVIDER || 'keyword').trim().toLowerCase();
  const problems = [];
  let provider = requested;
  let apiKey;
  let baseUrl;

  if (!PROVIDERS.includes(requested)) {
    problems.push(`SEARCH_PROVIDER="${requested}" is not one of ${PROVIDERS.join(', ')}`);
    provider = 'keyword';
  } else if (requested === 'anthropic') {
    apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) problems.push('SEARCH_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
  } else if (requested === 'openai') {
    apiKey = env.OPENAI_API_KEY;
    baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    if (!apiKey) problems.push('SEARCH_PROVIDER=openai needs OPENAI_API_KEY');
    if (!env.LLM_MODEL) problems.push('SEARCH_PROVIDER=openai needs LLM_MODEL (the model name your account can use)');
  } else if (requested === 'ollama') {
    baseUrl = env.OLLAMA_URL || 'http://127.0.0.1:11434/v1';
  }
  if (problems.length) provider = 'keyword';

  return {
    provider: /** @type {Config['provider']} */ (provider),
    requestedProvider: requested,
    model: provider === 'keyword' ? undefined : env.LLM_MODEL || DEFAULT_MODELS[provider],
    apiKey: provider === 'keyword' ? undefined : apiKey,
    baseUrl: provider === 'keyword' || !baseUrl ? undefined : baseUrl.replace(/\/+$/, ''),
    letterboxdDir: path.resolve(env.LETTERBOXD_DIR || path.join(__dirname, '..', 'data')),
    hideWatched: bool(env.HIDE_WATCHED, true),
    tasteHints: bool(env.TASTE_HINTS, true),
    maxResults: int(env.MAX_RESULTS, 20, 1, 50),
    timeoutMs: int(env.LLM_TIMEOUT_MS, 20000, 1000, 120000),
    problems,
  };
}

/**
 * A one-line, secret-free description for the startup log.
 * @param {Config} config
 */
function describe(config) {
  const backend = config.provider === 'keyword' ? 'keyword (no LLM)' : `${config.provider} (${config.model})`;
  return `search backend: ${backend}; hide watched: ${config.hideWatched}; taste hints: ${config.provider !== 'keyword' && config.tasteHints}; max results: ${config.maxResults}`;
}

module.exports = { loadConfig, describe, PROVIDERS, DEFAULT_MODELS };
