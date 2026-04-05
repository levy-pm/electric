const { createHash, randomUUID } = require('crypto');

const ACRONYMS = new Set([
  'ABS',
  'ACC',
  'ADAS',
  'BSW',
  'HUD',
  'ISOFIX',
  'LED',
  'OSE',
  'RCTA',
  'USB',
  'V2L',
  'WLTP',
]);

const LOWERCASE_WORDS = new Set([
  'a',
  'i',
  'na',
  'o',
  'od',
  'oraz',
  'po',
  'przed',
  'w',
  'z',
  'ze',
]);

const EQUIPMENT_SLUG_MAX_LENGTH = 255;

function slugify(input) {
  const baseSlug = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!baseSlug || baseSlug.length <= EQUIPMENT_SLUG_MAX_LENGTH) {
    return baseSlug;
  }

  const hashSuffix = createHash('sha1').update(baseSlug).digest('hex').slice(0, 12);
  const truncatedBase = baseSlug
    .slice(0, EQUIPMENT_SLUG_MAX_LENGTH - hashSuffix.length - 1)
    .replace(/-+$/g, '');

  return `${truncatedBase}-${hashSuffix}`;
}

function normalizeEquipmentToken(token, index) {
  const match = token.match(/^([(\["']*)(.*?)([)\]"',.:;!?]*)$/);
  if (!match) {
    return token;
  }

  const [, prefix, core, suffix] = match;
  if (!core) {
    return token;
  }

  if (core.includes('-') && !core.startsWith('e-') && !core.startsWith('E-')) {
    const normalizedHyphen = core
      .split('-')
      .map((part, partIndex) => normalizeEquipmentToken(part, partIndex))
      .join('-');
    return `${prefix}${normalizedHyphen}${suffix}`;
  }

  if (core.includes('/')) {
    const normalizedSlash = core
      .split('/')
      .map((part, partIndex) => normalizeEquipmentToken(part, partIndex))
      .join('/');
    return `${prefix}${normalizedSlash}${suffix}`;
  }

  const compact = core.replace(/[().]/g, '');
  const upperCompact = compact.toUpperCase();

  if (ACRONYMS.has(upperCompact) || /^[A-Z0-9&+-]{2,}$/.test(core)) {
    return `${prefix}${upperCompact}${suffix}`;
  }

  if (/[A-Z]/.test(core) && /[a-z]/.test(core)) {
    return `${prefix}${core}${suffix}`;
  }

  const lower = core.toLowerCase();
  if (index > 0 && LOWERCASE_WORDS.has(lower)) {
    return `${prefix}${lower}${suffix}`;
  }

  return `${prefix}${lower.charAt(0).toUpperCase()}${lower.slice(1)}${suffix}`;
}

function canonicalizeEquipmentLabel(rawValue) {
  const cleaned = String(rawValue || '')
    .replace(/[•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:.\-–—\s]+|[,;:.\-–—\s]+$/g, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned
    .split(' ')
    .map((token, index) => normalizeEquipmentToken(token, index))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeEquipmentList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const text = String(value || '');
    const chunks = text
      .split(/\r?\n|;/)
      .map((part) => canonicalizeEquipmentLabel(part))
      .filter(Boolean);

    chunks.forEach((label) => {
      const slug = slugify(label);
      if (!slug || seen.has(slug)) {
        return;
      }

      seen.add(slug);
      output.push(label);
    });
  });

  return output;
}

function buildEquipmentEntries(vehicle) {
  const groups = [
    ['standard', vehicle.standardEquipment || []],
    ['additional', vehicle.additionalEquipment || []],
    ['package', vehicle.equipmentPackages || []],
  ];

  return groups.flatMap(([type, items]) =>
    items.map((label, index) => ({
      id: randomUUID(),
      type,
      sortOrder: index,
      label,
      slug: slugify(label),
    }))
  );
}

module.exports = {
  buildEquipmentEntries,
  canonicalizeEquipmentLabel,
  canonicalizeEquipmentList,
  slugify,
};
