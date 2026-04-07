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

test('normalizeGeminiError marks transient Gemini file access errors as retryable', () => {
  const providerError = new Error('You do not have permission to access the File s2op5r9lx0li or it may not exist.');
  providerError.status = 400;

  const normalized = _internal.normalizeGeminiError(providerError);

  assert.equal(normalized.statusCode, 503);
  assert.equal(normalized.retryable, true);
  assert.match(normalized.message, /plik analizy gemini byl chwilowo niedostepny/i);
});

test('analyzeUploadedPdf deletes Gemini file only after extraction finishes', async () => {
  const events = [];
  let resolveExtraction;

  const ai = {
    files: {
      get: async () => ({
        uri: 'https://example.test/file.pdf',
        mimeType: 'application/pdf',
        name: 'files/s2op5r9lx0li',
        state: 'ACTIVE',
      }),
      delete: async () => {
        events.push('delete');
      },
    },
  };

  const uploadedFile = {
    uri: 'https://example.test/file.pdf',
    mimeType: 'application/pdf',
    name: 'files/s2op5r9lx0li',
  };

  const extractionPromise = _internal.analyzeUploadedPdf(
    ai,
    uploadedFile,
    'ioniq5.pdf',
    async () => {
      events.push('generate-start');
      await new Promise((resolve) => {
        resolveExtraction = () => {
          events.push('generate-end');
          resolve({ vehicles: [] });
        };
      });
      return { vehicles: [] };
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ['generate-start']);

  resolveExtraction();
  const result = await extractionPromise;

  assert.deepEqual(result, { vehicles: [] });
  assert.deepEqual(events, ['generate-start', 'generate-end', 'delete']);
});

test('waitForUploadedFileReady polls Gemini file until it becomes ACTIVE', async () => {
  let getCalls = 0;
  let sleepCalls = 0;

  const ai = {
    files: {
      get: async () => {
        getCalls += 1;
        return getCalls === 1
          ? {
              name: 'files/s2op5r9lx0li',
              uri: 'https://example.test/file.pdf',
              mimeType: 'application/pdf',
              state: 'PROCESSING',
            }
          : {
              name: 'files/s2op5r9lx0li',
              uri: 'https://example.test/file.pdf',
              mimeType: 'application/pdf',
              state: 'ACTIVE',
            };
      },
    },
  };

  const readyFile = await _internal.waitForUploadedFileReady(
    ai,
    {
      name: 'files/s2op5r9lx0li',
      uri: 'https://example.test/file.pdf',
      mimeType: 'application/pdf',
      state: 'PROCESSING',
    },
    {
      pollIntervalMs: 1,
      maxAttempts: 3,
      sleep: async () => {
        sleepCalls += 1;
      },
    }
  );

  assert.equal(readyFile.state, 'ACTIVE');
  assert.equal(getCalls, 2);
  assert.equal(sleepCalls, 2);
});
