const dns = require('dns').promises;
const net = require('net');
const rateLimit = require('express-rate-limit');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ');

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
}

function createRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || 'Zbyt wiele zapytan. Sprobuj ponownie pozniej.' },
  });
}

function ipv4ToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip) {
  const long = ipv4ToLong(ip);
  const ranges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
    ['255.255.255.255', 32],
  ];

  return ranges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (long & mask) === (ipv4ToLong(base) & mask);
  });
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();

  if (normalized === '::1' || normalized === '::') {
    return true;
  }

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIpv4(mapped[1]);
  }

  return (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }

  if (net.isIPv6(ip)) {
    return isPrivateIpv6(ip);
  }

  return true;
}

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function assertPublicUrl(inputUrl, options = {}) {
  if (options.allowPrivate) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw clientError('Nieprawidlowy adres URL.');
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw clientError('Obslugiwane sa tylko linki HTTP i HTTPS.');
  }

  if (parsed.username || parsed.password) {
    throw clientError('Adres URL nie moze zawierac danych logowania.');
  }

  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) {
    throw clientError('Adres URL wskazuje na adres prywatny.');
  }

  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw clientError('Nie udalo sie rozwiazac adresu z linku.');
  }

  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw clientError('Adres URL wskazuje na adres prywatny lub zarezerwowany.');
  }
}

module.exports = {
  securityHeaders,
  createRateLimiter,
  isPrivateAddress,
  assertPublicUrl,
  CONTENT_SECURITY_POLICY,
};
