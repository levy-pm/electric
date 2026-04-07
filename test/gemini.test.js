const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal } = require('../src/gemini');

test('normalizeGeminiError converts provider 503 high-demand payload into a friendly retryable message', () => {
  const providerError = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}');

  const normalized = _internal.normalizeGeminiError(providerError);

  assert.equal(normalized.statusCode, 503);
  assert.equal(normalized.retryable, true);
  assert.match(normalized.message, /chwilowo przeciazony/i);
});

test('retryGeminiOperation retries retryable Gemini errors and eventually resolves', async () => {
  let attempts = 0;

  const result = await _internal.retryGeminiOperation(
    async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
      }

      return 'ok';
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1,
      sleep: async () => {},
    }
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('retryGeminiOperation does not retry non-retryable Gemini errors', async () => {
  let attempts = 0;

  await assert.rejects(
    () => _internal.retryGeminiOperation(
      async () => {
        attempts += 1;
        const error = new Error('Nieprawidlowy format odpowiedzi.');
        error.status = 400;
        throw error;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: async () => {},
      }
    ),
    /Nieprawidlowy format odpowiedzi/
  );

  assert.equal(attempts, 1);
});
