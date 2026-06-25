const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseGeminiApiKeys(env = process.env) {
  const multiValue = String(env.GEMINI_API_KEYS || '').trim();
  const rawKeys = multiValue
    ? multiValue.split(',')
    : [env.GEMINI_API_KEY, env.GOOGLE_API_KEY];

  return [...new Set(rawKeys.map((value) => String(value || '').trim()).filter(Boolean))];
}

const geminiApiKeys = parseGeminiApiKeys();

const config = {
  rootDir,
  appName: 'electric',
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbMode: process.env.DB_MODE || (process.env.DB_NAME ? 'mariadb' : 'memory'),
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: toInt(process.env.DB_PORT, 3306),
  dbSocketPath: process.env.DB_SOCKET_PATH || '',
  dbName: process.env.DB_NAME || '',
  dbUser: process.env.DB_USER || '',
  dbPassword: process.env.DB_PASSWORD || '',
  geminiApiKeys,
  geminiApiKey: geminiApiKeys[0] || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiBusyRetryAttempts: toInt(process.env.GEMINI_BUSY_RETRY_ATTEMPTS, 3),
  geminiBusyRetryBaseDelayMs: toInt(process.env.GEMINI_BUSY_RETRY_BASE_DELAY_MS, 5000),
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'storage', 'uploads'),
  logsDir: path.join(rootDir, 'storage', 'logs'),
  maxFileSizeMb: toInt(process.env.MAX_FILE_SIZE_MB, 20),
  uploadRateLimitWindowMs: toInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  uploadRateLimitMax: toInt(process.env.UPLOAD_RATE_LIMIT_MAX, 20),
  apiRateLimitWindowMs: toInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  apiRateLimitMax: toInt(process.env.API_RATE_LIMIT_MAX, 120),
  writeRateLimitWindowMs: toInt(process.env.WRITE_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  writeRateLimitMax: toInt(process.env.WRITE_RATE_LIMIT_MAX, 30),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '256kb',
  trustProxy: toInt(process.env.TRUST_PROXY, 1),
  urlImportMaxBytes: toInt(process.env.URL_IMPORT_MAX_BYTES, 8 * 1024 * 1024),
  urlImportAllowPrivate: String(process.env.URL_IMPORT_ALLOW_PRIVATE || '').toLowerCase() === 'true',
  syncBranch: process.env.SYNC_BRANCH || 'main',
  nbpApiBaseUrl: process.env.NBP_API_BASE_URL || 'https://api.nbp.pl/api/',
  nbpCacheTtlMs: toInt(process.env.NBP_CACHE_TTL_MINUTES, 12 * 60) * 60 * 1000,
  nbpRequestTimeoutMs: toInt(process.env.NBP_REQUEST_TIMEOUT_MS, 8000),
};

function validateConfig(options = {}) {
  const { allowMissingGemini = false } = options;

  if (config.dbMode === 'mariadb') {
    const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((key) => {
      if (key === 'DB_NAME') return !config.dbName;
      if (key === 'DB_USER') return !config.dbUser;
      return !config.dbPassword;
    });

    if (missing.length > 0) {
      throw new Error(`Brakuje zmiennych bazy danych: ${missing.join(', ')}`);
    }
  }

  if (!allowMissingGemini && config.geminiApiKeys.length === 0) {
    throw new Error('Brakuje GEMINI_API_KEY lub GEMINI_API_KEYS.');
  }

  return config;
}

module.exports = {
  config,
  parseGeminiApiKeys,
  validateConfig,
};
