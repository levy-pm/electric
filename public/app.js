const DEFAULT_HIDDEN_FIELDS = new Set([
  'basePricePln',
  'allEquipment',
  'powerKw',
  'torqueNm',
  'model',
  'versionName',
  'exteriorColor',
  'wheels',
  'interiorTrim',
  'seats',
  'fuelType',
  'homologationStandard',
  'co2EmissionGkm',
  'configurationCode',
  'sourceDate',
  'notes',
  'equipmentPackages',
]);

const COLUMN_LAYOUT_KEY = 'electric_columns_v1';

const state = {
  table: null,
  allItems: [],
  filteredItems: [],
  summary: {},
  searchQuery: '',
  selectedEquipmentSlugs: [],
  equipmentSearchQuery: '',
  equipmentDropdownOpen: false,
  importMode: 'file',
  pendingFiles: [],
  activeOverlay: null,
  drawerReturnFocus: null,
  modalReturnFocus: null,
  applyingLayout: false,
  tooltipElement: null,
  tooltipTarget: null,
};

const equipEdit = {
  vehicleId: null,
  tab: 'standard',
  standard: [],
  additional: [],
};

// Etykiety odznak liderów — muszą być identyczne z BADGE_* w src/recommendation.js
const leaderLabels = {
  bestPrice: '💰 Najlepsza cena',
  bestRange: '🔋 Największy zasięg',
  bestEquipment: '🌿 Najbogatsze wyposażenie',
};

const INLINE_ARRAY_FIELDS = new Set([
  'combustionEquivalents',
  'equipmentPackages',
  'notes',
]);

const INLINE_NUMBER_FIELDS = new Set([
  'totalPricePln',
  'basePricePln',
  'rangeWltpKm',
  'batteryCapacityKwh',
  'powerHp',
  'powerKw',
  'torqueNm',
  'energyConsumptionKwh100km',
  'seats',
  'co2EmissionGkm',
]);

const INLINE_INTEGER_FIELDS = new Set([
  'seats',
]);

let inlineCellEditor = null;

function currencyFormatter(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 0,
  }).format(value);
}

function currencyFormatterEur(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function numberFormatter(value, unit = '', maximumFractionDigits = 1) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const formatted = new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits,
  }).format(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

function clampText(value) {
  const text = value !== null && value !== undefined && value !== '' ? String(value) : null;
  return `<span class="cell-clamp">${text ? escapeHtml(text) : '—'}</span>`;
}

function textArrayFormatter(values) {
  const text = Array.isArray(values) && values.length ? values.join(', ') : null;
  return `<span class="cell-clamp">${text ? escapeHtml(text) : '—'}</span>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTooltipTarget(node) {
  return node instanceof Element ? node.closest('[data-ui-tooltip]') : null;
}

function ensureTooltipElement() {
  if (state.tooltipElement && state.tooltipElement.isConnected) {
    return state.tooltipElement;
  }

  const tooltip = document.createElement('div');
  tooltip.id = 'uiTooltip';
  tooltip.className = 'ui-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.innerHTML = `
    <div class="ui-tooltip__content"></div>
    <div class="ui-tooltip__arrow" aria-hidden="true"></div>
  `;
  document.body.appendChild(tooltip);
  state.tooltipElement = tooltip;
  return tooltip;
}

function hideTooltip() {
  if (state.tooltipTarget) {
    state.tooltipTarget.removeAttribute('aria-describedby');
  }

  state.tooltipTarget = null;

  if (!state.tooltipElement) {
    return;
  }

  state.tooltipElement.classList.remove('is-visible');
  state.tooltipElement.setAttribute('aria-hidden', 'true');
}

function positionTooltip() {
  const tooltip = state.tooltipElement;
  const target = state.tooltipTarget;

  if (!tooltip || !target || !target.isConnected) {
    hideTooltip();
    return;
  }

  const gap = 12;
  const viewportPadding = 10;
  const targetRect = target.getBoundingClientRect();

  tooltip.style.left = '0px';
  tooltip.style.top = '0px';

  const tooltipRect = tooltip.getBoundingClientRect();
  let placement = 'top';
  let top = targetRect.top - tooltipRect.height - gap;

  if (top < viewportPadding) {
    placement = 'bottom';
    top = targetRect.bottom + gap;
  }

  let left = targetRect.left + ((targetRect.width - tooltipRect.width) / 2);
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));

  const anchorCenter = targetRect.left + (targetRect.width / 2);
  const arrowLeft = Math.max(16, Math.min(tooltipRect.width - 16, anchorCenter - left));

  tooltip.dataset.placement = placement;
  tooltip.style.left = `${Math.round(left + window.scrollX)}px`;
  tooltip.style.top = `${Math.round(top + window.scrollY)}px`;
  tooltip.style.setProperty('--tooltip-arrow-left', `${Math.round(arrowLeft)}px`);
}

function showTooltip(target) {
  const message = String(target.getAttribute('data-ui-tooltip') || '').trim();
  if (!message) {
    hideTooltip();
    return;
  }

  const tooltip = ensureTooltipElement();
  const content = tooltip.querySelector('.ui-tooltip__content');
  content.textContent = message;

  if (state.tooltipTarget && state.tooltipTarget !== target) {
    state.tooltipTarget.removeAttribute('aria-describedby');
  }

  state.tooltipTarget = target;
  target.setAttribute('aria-describedby', 'uiTooltip');
  tooltip.classList.add('is-visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionTooltip();
}

function bindTooltipEvents() {
  document.addEventListener('mouseover', (event) => {
    const target = getTooltipTarget(event.target);
    if (!target) {
      return;
    }

    if (state.tooltipTarget === target) {
      positionTooltip();
      return;
    }

    showTooltip(target);
  });

  document.addEventListener('mouseout', (event) => {
    const target = getTooltipTarget(event.target);
    if (!target || state.tooltipTarget !== target) {
      return;
    }

    const relatedTarget = getTooltipTarget(event.relatedTarget);
    if (relatedTarget === target) {
      return;
    }

    hideTooltip();
  });

  document.addEventListener('focusin', (event) => {
    const target = getTooltipTarget(event.target);
    if (target) {
      showTooltip(target);
    }
  });

  document.addEventListener('focusout', (event) => {
    const target = getTooltipTarget(event.target);
    if (!target || state.tooltipTarget !== target) {
      return;
    }

    const relatedTarget = getTooltipTarget(event.relatedTarget);
    if (relatedTarget === target) {
      return;
    }

    hideTooltip();
  });

  document.addEventListener('pointerdown', hideTooltip, true);
  window.addEventListener('scroll', positionTooltip, true);
  window.addEventListener('resize', positionTooltip);
}

async function saveVehiclePatch(vehicleId, patch) {
  const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Błąd podczas zapisywania.');
  }
  return payload;
}

// === MODAL WYPOSAŻENIA ===

function openEquipmentModal(rowData) {
  equipEdit.vehicleId = rowData.id;
  equipEdit.tab = 'standard';
  equipEdit.standard = [...(rowData.standardEquipment || [])];
  equipEdit.additional = [...(rowData.additionalEquipment || [])];

  document.getElementById('equipmentModalTitle').textContent = rowData.displayName || 'Wyposażenie';
  renderEquipmentTabButtons();
  renderEquipmentItems();
  updateEquipmentModalStatus('');
  document.getElementById('equipmentNewItem').value = '';

  document.getElementById('equipmentModal').classList.add('is-open');
  document.getElementById('equipmentModal').setAttribute('aria-hidden', 'false');
  setOverlay('equipModal');
}

function closeEquipmentModal() {
  const modal = document.getElementById('equipmentModal');
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (state.activeOverlay === 'equipModal') {
    setOverlay(null);
  }
}

function updateEquipmentModalStatus(message, isError = false) {
  const node = document.getElementById('equipmentModalStatus');
  node.textContent = message || '';
  node.style.color = isError ? 'var(--danger)' : '';
}

function renderEquipmentTabButtons() {
  document.querySelectorAll('[data-equip-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-equip-tab') === equipEdit.tab);
  });
}

function collectEquipmentInputs() {
  document.querySelectorAll('.equip-item-input').forEach((input) => {
    const idx = Number(input.getAttribute('data-index'));
    const val = input.value.trim();
    if (equipEdit.tab === 'standard') {
      equipEdit.standard[idx] = val;
    } else {
      equipEdit.additional[idx] = val;
    }
  });
}

function renderEquipmentItems() {
  const list = document.getElementById('equipmentItemsList');
  const items = equipEdit.tab === 'standard' ? equipEdit.standard : equipEdit.additional;
  const label = equipEdit.tab === 'standard' ? 'seryjnego' : 'dodatkowego';

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">Brak wyposażenia ${label}. Dodaj pozycje poniżej.</div>`;
    return;
  }

  list.innerHTML = items
    .map(
      (item, index) => `
      <div class="equip-item-row">
        <input class="equip-item-input" type="text" value="${escapeHtml(item)}" data-index="${index}" aria-label="Pozycja ${index + 1}" />
        <button class="icon-button equip-delete-btn" type="button" data-delete-index="${index}" aria-label="Usuń pozycję">×</button>
      </div>`
    )
    .join('');
}

function equipmentAddItem() {
  collectEquipmentInputs();
  const input = document.getElementById('equipmentNewItem');
  const value = input.value.trim();
  if (!value) return;

  if (equipEdit.tab === 'standard') {
    equipEdit.standard.push(value);
  } else {
    equipEdit.additional.push(value);
  }
  input.value = '';
  renderEquipmentItems();
  // Scroll to bottom of list
  const list = document.getElementById('equipmentItemsList');
  list.scrollTop = list.scrollHeight;
}

async function saveEquipmentModal() {
  collectEquipmentInputs();

  // Odfiltruj puste
  equipEdit.standard = equipEdit.standard.filter(Boolean);
  equipEdit.additional = equipEdit.additional.filter(Boolean);

  const saveBtn = document.getElementById('saveEquipmentButton');
  saveBtn.disabled = true;

  try {
    updateEquipmentModalStatus('Zapisuję...');
    await saveVehiclePatch(equipEdit.vehicleId, {
      standardEquipment: equipEdit.standard,
      additionalEquipment: equipEdit.additional,
    });
    showNotification('Wyposażenie zaktualizowane.');
    await loadCars();
    closeEquipmentModal();
  } catch (error) {
    updateEquipmentModalStatus(error.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

function getEyeIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5c4.9 0 9.1 2.9 11 7-1.9 4.1-6.1 7-11 7S2.9 16.1 1 12c1.9-4.1 6.1-7 11-7Zm0 2C8.4 7 5.2 9 3.4 12 5.2 15 8.4 17 12 17s6.8-2 8.6-5C18.8 9 15.6 7 12 7Zm0 2.5A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5Z"></path>
    </svg>
  `;
}

function rowBadgeFormatter(cell) {
  const badges = cell.getValue();
  const isTop = cell.getRow().getData().isSuggestedTop;
  const icons = [];

  if (isTop) {
    icons.push('<span class="rec-icon" data-ui-tooltip="Najlepsza wartość za pieniądze" aria-label="Najlepsza wartość za pieniądze">★</span>');
  }

  if (Array.isArray(badges) && badges.length) {
    for (const badge of badges) {
      const str = String(badge);
      const spaceIdx = str.indexOf(' ');
      const icon = spaceIdx > 0 ? str.slice(0, spaceIdx) : str;
      const label = spaceIdx > 0 ? str.slice(spaceIdx + 1) : str;
      icons.push(`<span class="rec-icon" data-ui-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</span>`);
    }
  }

  if (!icons.length) {
    return '<span class="rec-empty">—</span>';
  }

  return `<div class="rec-icons-row">${icons.join('')}</div>`;
}

function topRowFormatter(row) {
  row.getElement().classList.toggle('is-top-recommendation', Boolean(row.getData().isSuggestedTop));
  row.normalizeHeight();
}

function openConfiguration(rowData) {
  if (rowData.configurationSourceUrl) {
    window.open(rowData.configurationSourceUrl, '_blank', 'noopener');
    return;
  }

  if (rowData.configurationDownloadUrl) {
    window.location.assign(rowData.configurationDownloadUrl);
  }
}

function showNotification(message, isError = false, duration = 3000) {
  // Remove existing notifications
  const existingToasts = document.querySelectorAll('.toast-notification');
  existingToasts.forEach(toast => toast.remove());

  // Create new toast
  const toast = document.createElement('div');
  toast.className = `toast-notification ${isError ? 'toast-error' : 'toast-success'}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${isError ? '⚠️' : '✅'}</span>
      <span class="toast-message">${message}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  document.body.appendChild(toast);

  // Auto remove after duration
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, duration);
}

function configurationFormatter(cell) {
  const rowData = cell.getRow().getData();
  if (!rowData.configurationSourceUrl && !rowData.configurationDownloadUrl) {
    return '—';
  }

  const label = rowData.configurationSourceUrl ? 'Otwórz konfigurację' : 'Pobierz konfigurację';
  return `
    <button class="config-action-button" type="button" aria-label="${label}" data-ui-tooltip="${escapeHtml(label)}">
      ${getEyeIcon()}
    </button>
  `;
}

// Edytor textarea dla pakietów wyposażenia (wartość = tablica stringów)
const packageEditor = function (cell, onRendered, success, cancel) {
  const values = cell.getValue();
  const el = document.createElement('textarea');
  el.className = 'pkg-textarea-editor';
  el.value = Array.isArray(values) ? values.join('\n') : String(values || '');
  el.title = 'Jeden pakiet na linię. Ctrl+Enter = zapisz, Esc = anuluj';

  function save() {
    const newValues = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    success(newValues);
  }

  el.addEventListener('blur', save);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); }
  });

  onRendered(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  return el;
};

function editableClampFormatter(value) {
  const text = value !== null && value !== undefined && value !== '' ? String(value) : null;
  return `<span class="cell-clamp cell-editable">${text ? escapeHtml(text) : '\u2014'}</span>`;
}

function editableArrayFormatter(values) {
  const text = Array.isArray(values) && values.length ? values.join(', ') : null;
  return `<span class="cell-clamp cell-editable">${text ? escapeHtml(text) : '\u2014'}</span>`;
}

function editableNumberFormatter(value, unit = '', maximumFractionDigits = 1) {
  return `<span class="cell-editable">${escapeHtml(numberFormatter(value, unit, maximumFractionDigits))}</span>`;
}

function normalizeEditableArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTextEditorParams(inputMode = 'text') {
  return {
    selectContents: true,
    elementAttributes: {
      autocomplete: 'off',
      inputmode: inputMode,
      spellcheck: 'false',
    },
  };
}

const arrayInputEditor = function (cell, onRendered, success, cancel) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-inline-editor';
  input.value = normalizeEditableArray(cell.getValue()).join(', ');
  input.title = 'Oddziel kolejne pozycje przecinkiem. Enter = zapisz, Esc = anuluj.';

  function save() {
    success(normalizeEditableArray(input.value));
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });

  onRendered(() => {
    input.focus({ preventScroll: true });
    input.select();
  });

  return input;
};

function valuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function getInlineEditorComparableValue(field, value) {
  if (INLINE_ARRAY_FIELDS.has(field)) {
    return normalizeEditableArray(value);
  }

  if (INLINE_NUMBER_FIELDS.has(field)) {
    return value === null || value === undefined || value === '' ? null : Number(value);
  }

  return String(value || '').trim() || null;
}

function formatInlineEditorValue(field, value) {
  if (INLINE_ARRAY_FIELDS.has(field)) {
    return normalizeEditableArray(value).join(', ');
  }

  if (INLINE_NUMBER_FIELDS.has(field)) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }

  return value === null || value === undefined ? '' : String(value);
}

function parseInlineEditorValue(field, rawValue) {
  if (INLINE_ARRAY_FIELDS.has(field)) {
    return normalizeEditableArray(rawValue);
  }

  if (INLINE_NUMBER_FIELDS.has(field)) {
    const normalized = String(rawValue || '').trim().replace(',', '.');
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      throw new Error('Wpisz poprawną liczbę.');
    }

    if (INLINE_INTEGER_FIELDS.has(field) && !Number.isInteger(parsed)) {
      throw new Error('Wpisz liczbę całkowitą.');
    }

    return parsed;
  }

  return String(rawValue || '').trim() || null;
}

function destroyInlineCellEditor() {
  if (!inlineCellEditor) {
    return;
  }

  inlineCellEditor.cleanup?.();
  inlineCellEditor.input?.remove();
  inlineCellEditor = null;
}

function positionInlineCellEditor(editor) {
  if (!editor) {
    return;
  }

  const rect = editor.cell.getElement().getBoundingClientRect();
  editor.input.style.left = `${rect.left}px`;
  editor.input.style.top = `${rect.top}px`;
  editor.input.style.width = `${Math.max(rect.width, 120)}px`;
  editor.input.style.height = `${Math.max(rect.height, 40)}px`;
}

async function saveInlineCellEditor() {
  if (!inlineCellEditor || inlineCellEditor.saving) {
    return;
  }

  const editor = inlineCellEditor;
  let nextValue;

  try {
    nextValue = parseInlineEditorValue(editor.field, editor.input.value);
  } catch (error) {
    showNotification(error.message, true);
    editor.input.focus({ preventScroll: true });
    editor.input.select();
    return;
  }

  if (valuesEqual(nextValue, editor.originalValue)) {
    destroyInlineCellEditor();
    return;
  }

  editor.saving = true;
  editor.input.disabled = true;

  try {
    await saveVehiclePatch(editor.cell.getRow().getData().id, { [editor.field]: nextValue });
    destroyInlineCellEditor();
  } catch (error) {
    editor.saving = false;
    editor.input.disabled = false;
    editor.input.focus({ preventScroll: true });
    editor.input.select();
    showNotification(error.message, true);
    return;
  }

  try {
    await loadCars();
    showNotification('Zapisano zmiany.', false, 1800);
  } catch (_error) {
    showNotification('Zmiana została zapisana, ale nie udało się odświeżyć tabeli.', true, 2800);
  }
}

async function persistEditedCell(cell, patch, successMessage = 'Zapisano zmiany.') {
  try {
    await saveVehiclePatch(cell.getRow().getData().id, patch);
  } catch (error) {
    cell.restoreOldValue();
    showNotification(error.message, true);
    return;
  }

  try {
    await loadCars();
    showNotification(successMessage, false, 1800);
  } catch (_error) {
    showNotification('Zmiana została zapisana, ale nie udało się odświeżyć tabeli.', true, 2800);
  }
}

function makeTextCellEdited(field, successMessage = 'Zapisano zmiany.') {
  return async (cell) => {
    const nextValue = String(cell.getValue() || '').trim() || null;
    const previousValue = String(cell.getOldValue() || '').trim() || null;

    if (valuesEqual(nextValue, previousValue)) {
      return;
    }

    await persistEditedCell(cell, { [field]: nextValue }, successMessage);
  };
}

function makeNumberCellEdited(field, successMessage = 'Zapisano zmiany.') {
  return async (cell) => {
    const nextValue = cell.getValue() === '' ? null : cell.getValue();
    const previousValue = cell.getOldValue() === '' ? null : cell.getOldValue();

    if (valuesEqual(nextValue, previousValue)) {
      return;
    }

    await persistEditedCell(cell, { [field]: nextValue }, successMessage);
  };
}

function makeArrayCellEdited(field, successMessage = 'Zapisano zmiany.') {
  return async (cell) => {
    const nextValue = normalizeEditableArray(cell.getValue());
    const previousValue = normalizeEditableArray(cell.getOldValue());

    if (valuesEqual(nextValue, previousValue)) {
      return;
    }

    await persistEditedCell(cell, { [field]: nextValue }, successMessage);
  };
}

function getEditableColumnOverrides() {
  return {
    brand: {
      formatter: (cell) => {
        const raw = cell.getValue();
        if (!raw) {
          return editableClampFormatter(null);
        }

        const capitalized = String(raw)
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        return editableClampFormatter(capitalized);
      },
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('brand'),
    },
    displayName: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('displayName'),
    },
    totalPricePln: {
      formatter: priceCellFormatter('totalPricePln', 'totalPriceEur'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('totalPricePln'),
    },
    basePricePln: {
      formatter: priceCellFormatter('basePricePln', 'basePriceEur'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('basePricePln'),
    },
    rangeWltpKm: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'km'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('rangeWltpKm'),
    },
    batteryCapacityKwh: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kWh'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('batteryCapacityKwh'),
    },
    equipmentPackages: {
      formatter: packagesFormatter,
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('equipmentPackages'),
    },
    combustionEquivalents: {
      formatter: (cell) => editableArrayFormatter(cell.getValue()),
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('combustionEquivalents'),
    },
    powerHp: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'KM'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('powerHp'),
    },
    powerKw: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kW'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('powerKw'),
    },
    torqueNm: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'Nm'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('torqueNm'),
    },
    energyConsumptionKwh100km: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kWh/100 km'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('energyConsumptionKwh100km'),
    },
    model: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('model'),
    },
    versionName: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('versionName'),
    },
    exteriorColor: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('exteriorColor'),
    },
    wheels: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('wheels'),
    },
    interiorTrim: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('interiorTrim'),
    },
    seats: {
      formatter: (cell) => editableNumberFormatter(cell.getValue()),
      editor: 'number',
      editorParams: getTextEditorParams('numeric'),
      cellEdited: makeNumberCellEdited('seats'),
    },
    fuelType: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('fuelType'),
    },
    homologationStandard: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('homologationStandard'),
    },
    co2EmissionGkm: {
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'g/km'),
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('co2EmissionGkm'),
    },
    configurationCode: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('configurationCode'),
    },
    sourceDate: {
      formatter: (cell) => editableClampFormatter(cell.getValue()),
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('sourceDate'),
    },
    notes: {
      formatter: (cell) => editableArrayFormatter(cell.getValue()),
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('notes'),
    },
  };
}

function isInlineEditableCell(cell) {
  if (!cell) {
    return false;
  }

  const column = cell.getColumn ? cell.getColumn() : null;
  const field = column && column.getField ? column.getField() : null;
  if (!field) {
    return false;
  }

  return Boolean(getEditableColumnOverrides()[field]);
}

function triggerInlineEdit(cell) {
  if (!isInlineEditableCell(cell)) {
    return;
  }

  const field = cell.getColumn().getField();
  if (!field) {
    return;
  }

  if (inlineCellEditor && inlineCellEditor.cell === cell) {
    inlineCellEditor.input.focus({ preventScroll: true });
    inlineCellEditor.input.select();
    return;
  }

  destroyInlineCellEditor();

  const input = document.createElement('input');
  input.className = 'floating-cell-editor';
  input.type = INLINE_NUMBER_FIELDS.has(field) ? 'number' : 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;

  if (INLINE_INTEGER_FIELDS.has(field)) {
    input.inputMode = 'numeric';
    input.step = '1';
  } else if (INLINE_NUMBER_FIELDS.has(field)) {
    input.inputMode = 'decimal';
    input.step = 'any';
  } else {
    input.inputMode = 'text';
  }

  input.value = formatInlineEditorValue(field, cell.getValue());
  input.setAttribute('aria-label', `Edytuj ${cell.getColumn().getDefinition().title || field}`);

  const editor = {
    cell,
    field,
    input,
    originalValue: getInlineEditorComparableValue(field, cell.getValue()),
    saving: false,
    cleanup: null,
  };

  const syncPosition = () => {
    if (inlineCellEditor !== editor) {
      return;
    }

    positionInlineCellEditor(editor);
  };

  const onWindowKeyDown = (event) => {
    if (inlineCellEditor !== editor || editor.saving) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      destroyInlineCellEditor();
    }
  };

  editor.cleanup = () => {
    window.removeEventListener('scroll', syncPosition, true);
    window.removeEventListener('resize', syncPosition);
    document.removeEventListener('keydown', onWindowKeyDown, true);
  };

  document.body.appendChild(input);
  inlineCellEditor = editor;
  syncPosition();

  window.addEventListener('scroll', syncPosition, true);
  window.addEventListener('resize', syncPosition);
  document.addEventListener('keydown', onWindowKeyDown, true);

  input.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      destroyInlineCellEditor();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      await saveInlineCellEditor();
    }
  });

  input.addEventListener('blur', () => {
    if (inlineCellEditor === editor && !editor.saving) {
      destroyInlineCellEditor();
    }
  });

  window.setTimeout(() => {
    if (inlineCellEditor !== editor) {
      return;
    }

    input.focus({ preventScroll: true });
    input.select();
  }, 0);
}

function getCellComponentFromElement(cellElement) {
  if (!state.table || !cellElement) {
    return null;
  }

  const rowElement = cellElement.closest('.tabulator-row');
  const field = cellElement.getAttribute('tabulator-field');

  if (!rowElement || !field) {
    return null;
  }

  const row = state.table.getRows().find((candidate) => candidate.getElement() === rowElement);
  return row ? row.getCell(field) : null;
}

function handleInlineCellClick(event) {
  const target = event && event.target instanceof Element ? event.target : null;
  if (target && target.closest('button, a, input, textarea, select, [role="button"]')) {
    return;
  }

  const cellElement = target ? target.closest('.tabulator-cell') : null;
  if (!cellElement) {
    return;
  }

  const cell = getCellComponentFromElement(cellElement);
  if (!isInlineEditableCell(cell)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  triggerInlineEdit(cell);
}

async function enhanceEditableColumns() {
  if (!state.table) {
    return;
  }

  const overrides = getEditableColumnOverrides();
  const updates = state.table
    .getColumns()
    .map((column) => {
      const field = column.getField();
      return field && overrides[field] ? column.updateDefinition(overrides[field]) : null;
    })
    .filter(Boolean);

  if (updates.length) {
    await Promise.all(updates);
  }
}

function packagesFormatter(cell) {
  const values = cell.getValue();
  if (!Array.isArray(values) || !values.length) {
    return '<span class="cell-clamp cell-editable">—</span>';
  }
  return `<div class="pkg-lines cell-editable">${values.map((v) => `<div class="pkg-line">${escapeHtml(v)}</div>`).join('')}</div>`;
}

function equipActionFormatter(cell) {
  const data = cell.getRow().getData();
  const count = (data.standardEquipment || []).length + (data.additionalEquipment || []).length;
  return `<button class="equip-action-btn" type="button" aria-label="Edytuj wyposażenie" data-ui-tooltip="Edytuj wyposażenie">✏️ ${count} poz.</button>`;
}

function priceCellFormatter(fieldPln, fieldEur) {
  return function formatPriceCell(cell) {
    const rowData = cell.getRow().getData();
    const plnLabel = currencyFormatter(rowData[fieldPln]);
    const eurLabel = currencyFormatterEur(rowData[fieldEur]);
    const rateInfo = state.summary && state.summary.exchangeRate ? state.summary.exchangeRate : null;
    const tooltipParts = [];

    if (rateInfo && rateInfo.mid) {
      tooltipParts.push(rateInfo.tableNo ? `NBP ${rateInfo.tableNo}` : 'NBP');
      tooltipParts.push(`1 EUR = ${numberFormatter(rateInfo.mid, 'PLN', 4)}`);
      if (rateInfo.effectiveDate) {
        tooltipParts.push(rateInfo.effectiveDate);
      }
    }

    const tooltip = tooltipParts.length ? ` data-ui-tooltip="${escapeHtml(tooltipParts.join(' • '))}"` : '';
    const secondaryLine = eurLabel
      ? `<span class="price-secondary"${tooltip}>${escapeHtml(eurLabel)}</span>`
      : '';

    return `
      <div class="price-stack cell-editable">
        <span class="price-primary">${escapeHtml(plnLabel)}</span>
        ${secondaryLine}
      </div>
    `;
  };
}

function getColumns() {
  const editableOverrides = getEditableColumnOverrides();

  // widthGrow: ile wolnego miejsca dostaje kolumna (0 = nie rośnie, 1 = rośnie normalnie, 2 = rośnie podwójnie)
  // widthShrink: czy może się kurczyć poniżej minWidth (domyślnie 1)
  return [
    {
      title: 'Rekomendacja',
      field: 'recommendationBadges',
      formatter: rowBadgeFormatter,
      minWidth: 100,
      widthGrow: 0,
      hozAlign: 'center',
      headerSort: false,
    },
    {
      title: 'Marka',
      field: 'brand',
      minWidth: 100,
      widthGrow: 1,
      editor: 'input',
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('brand'),
      formatter: (cell) => {
        const raw = cell.getValue();
        if (!raw) return '<span class="cell-clamp">—</span>';
        const capitalized = String(raw).split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return `<span class="cell-clamp">${escapeHtml(capitalized)}</span>`;
      },
    },
    {
      title: 'Model',
      field: 'displayName',
      minWidth: 150,
      widthGrow: 2,
      formatter: (cell) => `<span class="cell-clamp cell-editable">${cell.getValue() ? escapeHtml(String(cell.getValue())) : '—'}</span>`,
      editor: 'input',
      cellEdited: async (cell) => {
        const rowData = cell.getRow().getData();
        const newName = String(cell.getValue() || '').trim();
        if (!newName) {
          cell.restoreOldValue();
          showNotification('Nazwa nie może być pusta.', true);
          return;
        }
        try {
          await saveVehiclePatch(rowData.id, { displayName: newName });
          showNotification('Nazwa zaktualizowana.');
        } catch (err) {
          cell.restoreOldValue();
          showNotification(err.message, true);
        }
      },
      editorParams: getTextEditorParams(),
      cellEdited: makeTextCellEdited('displayName'),
    },
    {
      title: 'Gabaryt',
      field: 'combustionEquivalents',
      minWidth: 220,
      widthGrow: 2,
      formatter: (cell) => textArrayFormatter(cell.getValue()),
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('combustionEquivalents'),
    },
    {
      title: 'Konfiguracja',
      field: 'uploadId',
      minWidth: 100,
      widthGrow: 0,
      headerSort: false,
      hozAlign: 'center',
      formatter: configurationFormatter,
      cellClick: (_event, cell) => {
        openConfiguration(cell.getRow().getData());
      },
    },
    {
      title: 'Wyposażenie',
      field: 'standardEquipmentCount',
      minWidth: 110,
      widthGrow: 0,
      headerSort: false,
      hozAlign: 'center',
      formatter: equipActionFormatter,
      cellClick: (_event, cell) => {
        openEquipmentModal(cell.getRow().getData());
      },
    },
    {
      title: 'Cena',
      field: 'totalPricePln',
      minWidth: 140,
      widthGrow: 1,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('totalPricePln'),
      formatter: priceCellFormatter('totalPricePln', 'totalPriceEur'),
    },
    {
      title: 'Cena bazowa',
      field: 'basePricePln',
      minWidth: 140,
      widthGrow: 1,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('basePricePln'),
      formatter: priceCellFormatter('basePricePln', 'basePriceEur'),
      visible: false,
    },
    {
      title: 'Zasięg WLTP',
      field: 'rangeWltpKm',
      minWidth: 120,
      widthGrow: 1,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('rangeWltpKm'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'km'),
    },
    {
      title: 'Bateria',
      field: 'batteryCapacityKwh',
      minWidth: 110,
      widthGrow: 1,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('batteryCapacityKwh'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kWh'),
    },
    {
      title: 'Pakiety',
      field: 'equipmentPackages',
      minWidth: 200,
      widthGrow: 2,
      formatter: packagesFormatter,
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('equipmentPackages'),
    },
    {
      title: 'Wszystkie elementy',
      field: 'allEquipment',
      minWidth: 280,
      widthGrow: 2,
      formatter: (cell) => textArrayFormatter(cell.getValue()),
      visible: false,
    },
    {
      title: 'Moc',
      field: 'powerHp',
      minWidth: 100,
      widthGrow: 0,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('powerHp'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'KM'),
    },
    {
      title: 'Moc kW',
      field: 'powerKw',
      minWidth: 100,
      widthGrow: 0,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('powerKw'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kW'),
      visible: false,
    },
    {
      title: 'Moment',
      field: 'torqueNm',
      minWidth: 110,
      widthGrow: 0,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('torqueNm'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'Nm'),
      visible: false,
    },
    {
      title: 'Zużycie energii',
      field: 'energyConsumptionKwh100km',
      minWidth: 160,
      widthGrow: 1,
      hozAlign: 'right',
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('energyConsumptionKwh100km'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'kWh/100 km'),
    },
    { title: 'Model skrócony', field: 'model', minWidth: 130, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Wersja', field: 'versionName', minWidth: 200, widthGrow: 2, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Kolor', field: 'exteriorColor', minWidth: 160, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Felgi', field: 'wheels', minWidth: 200, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Wnętrze', field: 'interiorTrim', minWidth: 200, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    {
      title: 'Liczba miejsc',
      field: 'seats',
      minWidth: 110,
      widthGrow: 0,
      hozAlign: 'right',
      visible: false,
      editor: 'number',
      editorParams: getTextEditorParams('numeric'),
      cellEdited: makeNumberCellEdited('seats'),
      formatter: (cell) => editableNumberFormatter(cell.getValue()),
    },
    { title: 'Paliwo', field: 'fuelType', minWidth: 130, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Homologacja', field: 'homologationStandard', minWidth: 150, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    {
      title: 'CO₂',
      field: 'co2EmissionGkm',
      minWidth: 90,
      widthGrow: 0,
      hozAlign: 'right',
      visible: false,
      editor: 'number',
      editorParams: getTextEditorParams('decimal'),
      cellEdited: makeNumberCellEdited('co2EmissionGkm'),
      formatter: (cell) => editableNumberFormatter(cell.getValue(), 'g/km'),
    },
    { title: 'Kod konfiguracji', field: 'configurationCode', minWidth: 160, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    { title: 'Data konfiguracji', field: 'sourceDate', minWidth: 150, widthGrow: 1, visible: false, formatter: (cell) => clampText(cell.getValue()) },
    {
      title: 'Notatki',
      field: 'notes',
      minWidth: 280,
      visible: false,
      formatter: (cell) => editableArrayFormatter(cell.getValue()),
      editor: arrayInputEditor,
      cellEdited: makeArrayCellEdited('notes'),
    },
  ].map((definition) => {
    if (!definition.field || !editableOverrides[definition.field]) {
      return definition;
    }

    return {
      ...definition,
      ...editableOverrides[definition.field],
    };
  }).concat([{
    title: 'Akcje',
    field: '_actions',
    minWidth: 90,
    width: 90,
    widthGrow: 0,
    hozAlign: 'center',
    headerSort: false,
    resizable: false,
    formatter: () => `<div class="action-btns">
        <button class="action-btn action-btn--view" data-action="view" title="Podgląd" aria-label="Podgląd">👁</button>
        <button class="action-btn action-btn--delete" data-action="delete" title="Usuń" aria-label="Usuń">🗑</button>
      </div>`,
    cellClick: (e, cell) => {
      const action = e.target.closest('[data-action]')?.getAttribute('data-action');
      if (!action) return;
      const rowData = cell.getRow().getData();
      if (action === 'view') openPreviewModal(rowData);
      if (action === 'delete') openDeleteModal(rowData);
    },
  }]);
}

function saveColumnLayout() {
  if (!state.table) return;
  try {
    const layout = state.table.getColumns()
      .filter((col) => col.getField())
      .map((col) => ({ field: col.getField(), visible: col.isVisible() }));
    localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(layout));
  } catch {}
}

function loadColumnLayout() {
  try {
    const raw = localStorage.getItem(COLUMN_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function applyColumnLayout(layout) {
  if (!state.table || !Array.isArray(layout)) return;

  const currentFields = new Set(
    state.table.getColumns().map((c) => c.getField()).filter(Boolean)
  );
  const valid = layout.filter(({ field }) => currentFields.has(field));

  state.applyingLayout = true;
  try {
    // Widoczność
    for (const { field, visible } of valid) {
      const col = state.table.getColumns().find((c) => c.getField() === field);
      if (!col) continue;
      visible ? col.show() : col.hide();
    }

    // Kolejność — od końca, każda kolumna przesuwa się PRZED następną
    for (let i = valid.length - 2; i >= 0; i--) {
      state.table.moveColumn(valid[i].field, valid[i + 1].field, false);
    }
  } finally {
    state.applyingLayout = false;
  }
}

function renderColumnsDrawerContent() {
  const columnsList = document.getElementById('columnsList');
  columnsList.innerHTML = '';

  if (!state.table) {
    columnsList.innerHTML = '<div class="empty-state">Tabela pojawi się po załadowaniu danych.</div>';
    return;
  }

  let dragSrcField = null;

  state.table.getColumns()
    .filter((col) => col.getField())
    .forEach((column) => {
      const field = column.getField();

      const item = document.createElement('div');
      item.className = 'column-toggle';
      item.draggable = true;
      item.dataset.field = field;

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.textContent = '\u22ee\u22ee'; // ⋮⋮

      const label = document.createElement('span');
      label.className = 'column-toggle-label';
      label.textContent = column.getDefinition().title;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = column.isVisible();
      input.addEventListener('change', () => {
        if (input.checked) column.show(); else column.hide();
        saveColumnLayout();
      });

      item.addEventListener('dragstart', (e) => {
        dragSrcField = field;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', field);
        setTimeout(() => item.classList.add('is-dragging'), 0);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
        columnsList.querySelectorAll('.drag-over-top, .drag-over-bottom')
          .forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragSrcField || dragSrcField === field) return;
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        columnsList.querySelectorAll('.drag-over-top, .drag-over-bottom')
          .forEach((el) => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        item.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!dragSrcField || dragSrcField === field) return;

        const rect = item.getBoundingClientRect();
        const dropAfter = e.clientY >= rect.top + rect.height / 2;
        state.table.moveColumn(dragSrcField, field, dropAfter);
        saveColumnLayout();
      });

      item.append(handle, label, input);
      columnsList.append(item);
    });
}


function createTable(items) {
  hideTooltip();

  if (state.table) {
    state.table.setColumns(getColumns());
    const savedLayout = loadColumnLayout();
    if (savedLayout) applyColumnLayout(savedLayout);
    state.table.replaceData(items);
    renderColumnsDrawerContent();
    return;
  }

  state.table = new Tabulator('#tableContainer', {
    data: items,
    layout: 'fitColumns',
    editTriggerEvent: 'click',
    movableColumns: true,
    placeholder: '<div class="empty-state">Brak konfiguracji. Dodaj pierwszy PDF albo link, aby zbudować tabelę.</div>',
    rowFormatter: topRowFormatter,
    columns: getColumns(),
    pagination: true,
    paginationSize: 30,
    paginationSizeSelector: [10, 30, 50, 100, true],
    paginationCounter: 'rows',
    locale: 'pl',
    langs: {
      pl: {
        pagination: {
          page_size: 'Na stronę',
          page_title: 'Pokaż stronę',
          first: '«',
          first_title: 'Pierwsza',
          last: '»',
          last_title: 'Ostatnia',
          prev: '‹',
          prev_title: 'Poprzednia',
          next: '›',
          next_title: 'Następna',
          all: 'Wszystkie',
          counter: {
            showing: 'Wyniki',
            of: 'z',
            rows: '',
            pages: 'str.',
          },
        },
      },
    },
  });

  state.table.on('tableBuilt', async () => {
    await enhanceEditableColumns();
    const savedLayout = loadColumnLayout();
    if (savedLayout) {
      applyColumnLayout(savedLayout);
    }
    renderColumnsDrawerContent();
  });

  state.table.on('columnMoved', () => {
    if (!state.applyingLayout) {
      saveColumnLayout();
      renderColumnsDrawerContent();
    }
  });

  state.table.on('columnVisibilityChanged', () => {
    if (!state.applyingLayout) {
      saveColumnLayout();
    }
  });

  const tableContainer = document.getElementById('tableContainer');
  if (tableContainer && !tableContainer.dataset.inlineEditBound) {
    tableContainer.addEventListener('click', handleInlineCellClick, true);
    tableContainer.dataset.inlineEditBound = 'true';
  }
}

function updateStatus(message, isError = false) {
  const node = document.getElementById('statusMessage');
  node.textContent = message || '';
  node.style.color = isError ? 'var(--danger)' : '';
}

function updateImportStatus(message, isError = false) {
  const node = document.getElementById('importModalStatus');
  node.textContent = message || '';
  node.style.color = isError ? 'var(--danger)' : '';
}

function updateSummary(items) {
  const topCarName = document.getElementById('topCarName');
  const topCarMeta = document.getElementById('topCarMeta');
  const topCarBadges = document.getElementById('topCarBadges');
  const leaderCards = document.getElementById('leaderCards');

  if (!items.length) {
    topCarName.textContent = 'Brak danych';
    topCarMeta.textContent = 'Dodaj pierwszą konfigurację, aby zobaczyć najlepszą propozycję.';
    topCarBadges.innerHTML = '';
    leaderCards.innerHTML = '';
    return;
  }

  const top = items[0];
  topCarName.textContent = [top.brand, top.model].filter(Boolean).join(' ') || top.displayName || 'Bez nazwy';

  // Pokaż kluczowe metryki + wskaźnik VfM: koszt 1000 km zasięgu (tys. zł / 1000 km)
  const plnPer1000km =
    top.rangeWltpKm && top.totalPricePln && top.totalPricePln > 0
      ? Math.round(top.totalPricePln / top.rangeWltpKm)
      : null;

  topCarMeta.textContent = [
    currencyFormatter(top.totalPricePln),
    numberFormatter(top.rangeWltpKm, 'km zasięgu'),
    top.batteryCapacityKwh ? numberFormatter(top.batteryCapacityKwh, 'kWh') : null,
    plnPer1000km !== null ? `${plnPer1000km} zł/km zasięgu` : null,
  ]
    .filter(Boolean)
    .join(' • ');

  topCarBadges.innerHTML = (top.recommendationBadges || [])
    .map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`)
    .join('');

  // Mapa: badge string → pierwszy pojazd z tą odznaką
  const leaderByBadge = {};
  items.forEach((item) => {
    (item.recommendationBadges || []).forEach((badge) => {
      if (!leaderByBadge[badge]) {
        leaderByBadge[badge] = item;
      }
    });
  });

  const getLeaderCardValue = (_label, item) => {
    if (!item) {
      return '—';
    }

    return [item.brand, item.model].filter(Boolean).join(' ') || item.displayName || 'Bez nazwy';
  };

  leaderCards.innerHTML = Object.values(leaderLabels)
    .map((label) => {
      const item = leaderByBadge[label];
      return `
        <article class="leader-card">
          <span class="eyebrow">${escapeHtml(label)}</span>
          <strong>${escapeHtml(getLeaderCardValue(label, item))}</strong>
        </article>
      `;
    })
    .join('');
}

function getEquipmentFacets() {
  return state.summary.equipmentFacets || [];
}

function setEquipmentDropdownOpen(isOpen) {
  state.equipmentDropdownOpen = Boolean(isOpen);
  const button = document.getElementById('equipmentSelectButton');
  const dropdown = document.getElementById('equipmentDropdown');

  button.setAttribute('aria-expanded', String(state.equipmentDropdownOpen));
  dropdown.hidden = !state.equipmentDropdownOpen;

  if (state.equipmentDropdownOpen) {
    document.getElementById('equipmentSearchInput').focus();
  }
}

function toggleEquipmentSelection(slug) {
  if (state.selectedEquipmentSlugs.includes(slug)) {
    state.selectedEquipmentSlugs = state.selectedEquipmentSlugs.filter((item) => item !== slug);
  } else {
    state.selectedEquipmentSlugs = [...state.selectedEquipmentSlugs, slug];
  }

  applyFilters();
}

function renderEquipmentSelect() {
  const selectedChips = document.getElementById('equipmentSelectedChips');
  const optionsNode = document.getElementById('equipmentOptions');
  const labelNode = document.getElementById('equipmentSelectLabel');
  const query = state.equipmentSearchQuery.trim().toLowerCase();
  const facets = getEquipmentFacets();
  const visibleFacets = facets.filter((facet) =>
    !query || facet.label.toLowerCase().includes(query)
  );

  selectedChips.innerHTML = state.selectedEquipmentSlugs
    .map((slug) => {
      const facet = facets.find((item) => item.slug === slug);
      if (!facet) {
        return '';
      }

      return `
        <span class="selected-chip">
          ${escapeHtml(facet.label)}
          <button type="button" data-remove-equipment="${escapeHtml(slug)}" aria-label="Usuń ${escapeHtml(
            facet.label
          )}">
            ×
          </button>
        </span>
      `;
    })
    .join('');

  optionsNode.innerHTML = visibleFacets.length
    ? visibleFacets
        .map((facet) => {
          const isSelected = state.selectedEquipmentSlugs.includes(facet.slug);
          return `
            <button
              class="multi-select-option${isSelected ? ' is-selected' : ''}"
              type="button"
              data-equipment-option="${escapeHtml(facet.slug)}"
            >
              <div>
                <strong>${escapeHtml(facet.label)}</strong>
                <span>${facet.usageCount} konfiguracji</span>
              </div>
              <span>${isSelected ? 'Wybrane' : 'Dodaj'}</span>
            </button>
          `;
        })
        .join('')
    : '<div class="empty-state">Brak wyposażenia pasującego do wyszukiwania.</div>';

  labelNode.textContent = state.selectedEquipmentSlugs.length
    ? `Wybrano: ${state.selectedEquipmentSlugs.length}`
    : 'Wybierz elementy wyposażenia';
}

function applyFilters() {
  const query = state.searchQuery.trim().toLowerCase();
  const selectedEquipment = state.selectedEquipmentSlugs;

  state.filteredItems = state.allItems.filter((item) => {
    const searchPool = [
      item.displayName,
      item.brand,
      item.model,
      item.versionName,
      item.exteriorColor,
      item.wheels,
      item.interiorTrim,
      ...(item.allEquipment || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const searchMatch = !query || searchPool.includes(query);
    const equipmentMatch =
      !selectedEquipment.length ||
      selectedEquipment.every((slug) => (item.equipmentSlugs || []).includes(slug));

    return searchMatch && equipmentMatch;
  });

  createTable(state.filteredItems);
  updateSummary(state.filteredItems);
  renderEquipmentSelect();
}

function resetColumnVisibility() {
  if (!state.table) {
    return;
  }

  try { localStorage.removeItem(COLUMN_LAYOUT_KEY); } catch {}

  // Przywróć domyślną kolejność i widoczność przez pełny rebuild kolumn
  state.table.setColumns(getColumns());
  renderColumnsDrawerContent();
}

function showAllColumns() {
  if (!state.table) {
    return;
  }

  state.table.getColumns().forEach((column) => {
    if (column.getField()) {
      column.show();
    }
  });

  renderColumnsDrawerContent();
}

function setOverlay(name) {
  state.activeOverlay = name;
  document.body.classList.toggle('has-overlay', Boolean(name));
  document.documentElement.style.overflow = name ? 'hidden' : '';
}

function focusElement(node) {
  if (node && typeof node.focus === 'function') {
    node.focus();
  }
}

function openDrawer() {
  state.drawerReturnFocus = document.activeElement;
  renderColumnsDrawerContent();
  document.getElementById('columnsDrawer').classList.add('is-open');
  document.getElementById('columnsDrawer').setAttribute('aria-hidden', 'false');
  setOverlay('drawer');
  focusElement(document.getElementById('closeColumnsButton'));
}

function closeDrawer() {
  const drawer = document.getElementById('columnsDrawer');
  if (drawer.contains(document.activeElement)) {
    focusElement(state.drawerReturnFocus || document.getElementById('columnsButton'));
  }

  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  if (state.activeOverlay === 'drawer') {
    setOverlay(null);
  }
}

function setImportMode(mode) {
  state.importMode = ['url', 'manual'].includes(mode) ? mode : 'file';

  document.getElementById('importFileTab').classList.toggle('is-active', state.importMode === 'file');
  document.getElementById('importUrlTab').classList.toggle('is-active', state.importMode === 'url');
  document.getElementById('importManualTab').classList.toggle('is-active', state.importMode === 'manual');

  document.getElementById('importFilePanel').hidden = state.importMode !== 'file';
  document.getElementById('importFilePanel').classList.toggle('is-active', state.importMode === 'file');
  document.getElementById('importUrlPanel').hidden = state.importMode !== 'url';
  document.getElementById('importUrlPanel').classList.toggle('is-active', state.importMode === 'url');
  document.getElementById('importManualPanel').hidden = state.importMode !== 'manual';
  document.getElementById('importManualPanel').classList.toggle('is-active', state.importMode === 'manual');
}

function resetImportForm() {
  state.pendingFiles = [];
  document.getElementById('modalUploadInput').value = '';
  document.getElementById('configurationUrlInput').value = '';
  document.getElementById('selectedFileName').textContent = 'Nie wybrano plikow.';
  [
    'manualBrand', 'manualModel', 'manualVersion', 'manualDisplayName', 'manualColor',
    'manualPrice', 'manualBasePricePln', 'manualRange', 'manualBattery',
    'manualPower', 'manualPowerKw', 'manualTorqueNm', 'manualConsumption',
    'manualCo2', 'manualSeats', 'manualWheels', 'manualInteriorTrim',
    'manualFuelType', 'manualHomologation', 'manualConfigCode', 'manualSourceDate',
    'manualCombustionEquivalents', 'manualEquipmentPackages',
    'manualStandardEquipment', 'manualAdditionalEquipment', 'manualNotes',
  ].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('manualFileInput').value = '';
  document.getElementById('manualFileName').textContent = 'Nie wybrano pliku';
  updateImportStatus('');
  setImportMode('file');
}

function openImportModal() {
  state.modalReturnFocus = document.activeElement;
  resetImportForm();
  document.getElementById('importModal').classList.add('is-open');
  document.getElementById('importModal').setAttribute('aria-hidden', 'false');
  setOverlay('modal');
  focusElement(document.getElementById('importFileTab'));
}

function closeImportModal() {
  const modal = document.getElementById('importModal');
  if (modal.contains(document.activeElement)) {
    focusElement(state.modalReturnFocus || document.getElementById('uploadButton'));
  }

  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (state.activeOverlay === 'modal') {
    setOverlay(null);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractHtmlErrorMessage(rawText) {
  const text = String(rawText || '').trim();
  if (!text.startsWith('<')) {
    return null;
  }

  const titleMatch = text.match(/<title>\s*([^<]+?)\s*<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const headingMatch =
    text.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i) ||
    text.match(/<h2[^>]*>\s*([^<]+?)\s*<\/h2>/i);
  return headingMatch ? headingMatch[1].trim() : 'Serwer zwrocil strone bledu zamiast odpowiedzi API.';
}

async function readApiPayload(response, fallbackMessage) {
  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (response.ok) {
    return payload || {};
  }

  const htmlMessage = extractHtmlErrorMessage(rawText);
  const error = new Error(
    (payload && (payload.error || payload.message)) ||
    htmlMessage ||
    fallbackMessage ||
    'Wystapil blad API.'
  );
  error.statusCode = response.status;
  error.rawText = rawText;
  error.payload = payload;
  throw error;
}

async function loadCars() {
  const response = await fetch('/api/cars');
  const payload = await readApiPayload(response, 'Nie udalo sie pobrac tabeli.');

  state.allItems = payload.items || [];
  state.summary = payload.summary || {};
  applyFilters();
  renderColumnsDrawerContent();
}

async function waitForUploadCompletion(uploadId, fileName) {
  const deadline = Date.now() + 15 * 60 * 1000;

  while (Date.now() < deadline) {
    const response = await fetch(`/api/uploads/${encodeURIComponent(uploadId)}/status`);
    const payload = await readApiPayload(response, 'Nie udalo sie sprawdzic statusu importu.');

    if (payload.status === 'completed') {
      return {
        message: payload.message || `Plik ${fileName} zostal odczytany i dodany do tabeli.`,
        uploadId,
        items: payload.items || [],
      };
    }

    if (payload.status === 'failed') {
      throw new Error(payload.error || `Nie udalo sie przetworzyc pliku ${fileName}.`);
    }

    updateImportStatus(`Plik ${fileName} zostal przyjety. Trwa analiza...`);
    await delay(2500);
  }

  throw new Error('Analiza pliku trwa dluzej niz zwykle. Sprobuj ponownie za chwile.');
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('configurationPdf', file);

  const response = await fetch('/api/upload-async', {
    method: 'POST',
    body: formData,
  });
  const payload = await readApiPayload(response, 'Nie udalo sie przyjac pliku PDF.');
  return waitForUploadCompletion(payload.uploadId, file.name);
}

function getPendingFilesLabel(files) {
  if (!Array.isArray(files) || !files.length) {
    return 'Nie wybrano plikow.';
  }

  if (files.length === 1) {
    return `Wybrano: ${files[0].name}`;
  }

  const preview = files
    .slice(0, 3)
    .map((file) => file.name)
    .join(', ');
  const suffix = files.length > 3 ? ` (+${files.length - 3} kolejne)` : '';
  return `Wybrano ${files.length} pliki: ${preview}${suffix}`;
}

function buildBulkImportStatus(successes, failures) {
  if (successes && !failures) {
    return successes === 1
      ? '1 konfiguracja zostala dodana.'
      : `${successes} konfiguracje zostaly dodane.`;
  }

  if (successes && failures) {
    return `${successes} konfiguracje dodane, ${failures} nieudane.`;
  }

  return failures === 1
    ? 'Nie udalo sie dodac 1 konfiguracji.'
    : `Nie udalo sie dodac ${failures} konfiguracji.`;
}

async function importUrl(url) {
  const response = await fetch('/api/import-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  return readApiPayload(response, 'Nie udalo sie przetworzyc linku.');
}

async function submitImport() {
  return submitImportBatch();
}

async function submitImportBatch() {
  const confirmButton = document.getElementById('confirmImportButton');
  confirmButton.disabled = true;

  try {
    if (state.importMode === 'file') {
      if (!state.pendingFiles.length) {
        throw new Error('Najpierw wybierz co najmniej jeden plik PDF.');
      }

      const successes = [];
      const failures = [];

      for (let index = 0; index < state.pendingFiles.length; index += 1) {
        const file = state.pendingFiles[index];
        updateImportStatus(`Analizuje plik ${index + 1}/${state.pendingFiles.length}: ${file.name}...`);

        try {
          const payload = await uploadFile(file);
          successes.push({
            fileName: file.name,
            uploadId: payload.uploadId,
          });
        } catch (error) {
          failures.push({
            fileName: file.name,
            message: error.message,
          });
        }
      }

      if (!successes.length) {
        const details = failures
          .slice(0, 3)
          .map((entry) => `${entry.fileName}: ${entry.message}`)
          .join(' | ');
        throw new Error(details || 'Nie udalo sie przetworzyc wybranych plikow.');
      }

      closeImportModal();
      showNotification(buildBulkImportStatus(successes.length, failures.length), failures.length > 0);
      await loadCars();
      return;
    }

    if (state.importMode === 'url') {
      const url = document.getElementById('configurationUrlInput').value.trim();
      if (!url) {
        throw new Error('Wklej link do konfiguracji.');
      }

      updateImportStatus('Analizuje link do konfiguracji...');
      const payload = await importUrl(url);

      closeImportModal();
      showNotification(payload.message || 'Konfiguracja została dodana.');
      await loadCars();
      return;
    }

    // Ręczny wpis
    const brand = document.getElementById('manualBrand').value.trim();
    const model = document.getElementById('manualModel').value.trim();
    if (!brand && !model) {
      throw new Error('Podaj markę lub model pojazdu.');
    }

    updateImportStatus('Zapisuję konfigurację...');
    const manualFormData = new FormData();
    [
      ['brand', 'manualBrand'], ['model', 'manualModel'], ['versionName', 'manualVersion'],
      ['displayName', 'manualDisplayName'], ['exteriorColor', 'manualColor'],
      ['wheels', 'manualWheels'], ['interiorTrim', 'manualInteriorTrim'],
      ['fuelType', 'manualFuelType'], ['homologationStandard', 'manualHomologation'],
      ['configurationCode', 'manualConfigCode'], ['sourceDate', 'manualSourceDate'],
    ].forEach(([key, id]) => {
      const val = document.getElementById(id).value.trim();
      if (val) manualFormData.set(key, val);
    });
    [
      ['totalPricePln', 'manualPrice'], ['basePricePln', 'manualBasePricePln'],
      ['rangeWltpKm', 'manualRange'], ['batteryCapacityKwh', 'manualBattery'],
      ['powerHp', 'manualPower'], ['powerKw', 'manualPowerKw'],
      ['torqueNm', 'manualTorqueNm'], ['energyConsumptionKwh100km', 'manualConsumption'],
      ['co2EmissionGkm', 'manualCo2'], ['seats', 'manualSeats'],
    ].forEach(([key, id]) => {
      const val = document.getElementById(id).value.trim();
      if (val) manualFormData.set(key, val);
    });
    [
      ['combustionEquivalents', 'manualCombustionEquivalents'],
      ['equipmentPackages', 'manualEquipmentPackages'],
      ['standardEquipment', 'manualStandardEquipment'],
      ['additionalEquipment', 'manualAdditionalEquipment'],
      ['notes', 'manualNotes'],
    ].forEach(([key, id]) => {
      const val = document.getElementById(id).value.trim();
      if (val) manualFormData.set(key, val);
    });
    const manualFile = document.getElementById('manualFileInput').files[0];
    if (manualFile) manualFormData.set('configurationFile', manualFile);

    const response = await fetch('/api/manual', {
      method: 'POST',
      body: manualFormData,
    });
    const payload = await readApiPayload(response, 'Nie udało się zapisać konfiguracji.');

    closeImportModal();
    showNotification(payload.message || 'Konfiguracja została dodana.');
    await loadCars();
  } catch (error) {
    updateImportStatus(error.message, true);
  } finally {
    confirmButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Modal usunięcia
// ---------------------------------------------------------------------------

let _pendingDeleteId = null;

function openDeleteModal(rowData) {
  const name = [rowData.brand, rowData.model].filter(Boolean).join(' ') || rowData.displayName || 'tę konfigurację';
  _pendingDeleteId = rowData.id;
  document.getElementById('deleteModalBody').textContent =
    `Czy na pewno chcesz usunąć „${name}"? Tej operacji nie można cofnąć.`;
  const modal = document.getElementById('deleteModal');
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  setOverlay('deleteModal');
  document.getElementById('confirmDeleteButton').focus();
}

function closeDeleteModal() {
  _pendingDeleteId = null;
  const modal = document.getElementById('deleteModal');
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (state.activeOverlay === 'deleteModal') setOverlay(null);
}

async function confirmDelete() {
  if (!_pendingDeleteId) return;
  const id = _pendingDeleteId;
  const btn = document.getElementById('confirmDeleteButton');

  btn.disabled = true;
  btn.textContent = 'Usuwanie…';

  try {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await readApiPayload(res, 'Nie udało się usunąć konfiguracji.');
    closeDeleteModal();
    showNotification('Konfiguracja została usunięta.');
    await loadCars();
  } catch (err) {
    closeDeleteModal();
    showNotification(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Usuń';
  }
}

// ---------------------------------------------------------------------------
// Modal podglądu
// ---------------------------------------------------------------------------

function openPreviewModal(rowData) {
  const name = [rowData.brand, rowData.model, rowData.versionName].filter(Boolean).join(' ') || rowData.displayName || 'Konfiguracja';
  document.getElementById('previewModalTitle').textContent = name;

  const rows = [
    ['Marka', rowData.brand],
    ['Model', rowData.model],
    ['Wersja', rowData.versionName],
    ['Kolor', rowData.exteriorColor],
    ['Cena końcowa', rowData.totalPricePln != null ? currencyFormatter(rowData.totalPricePln) : null],
    ['Zasięg WLTP', rowData.rangeWltpKm != null ? numberFormatter(rowData.rangeWltpKm, 'km') : null],
    ['Bateria', rowData.batteryCapacityKwh != null ? numberFormatter(rowData.batteryCapacityKwh, 'kWh') : null],
    ['Moc', rowData.powerHp != null ? numberFormatter(rowData.powerHp, 'KM') : null],
    ['Zużycie', rowData.energyConsumptionKwh100km != null ? numberFormatter(rowData.energyConsumptionKwh100km, 'kWh/100 km') : null],
    ['Moment obrotowy', rowData.torqueNm != null ? numberFormatter(rowData.torqueNm, 'Nm') : null],
    ['Felgi', rowData.wheels],
    ['Wnętrze', rowData.interiorTrim],
    ['CO₂', rowData.co2EmissionGkm != null ? numberFormatter(rowData.co2EmissionGkm, 'g/km') : null],
    ['Homologacja', rowData.homologationStandard],
    ['Kod konfiguracji', rowData.configurationCode],
    ['Data konfiguracji', rowData.sourceDate],
  ].filter(([, v]) => v != null && v !== '');

  const equipRows = [
    ['Wyposażenie seryjne', rowData.standardEquipment],
    ['Opcje dodatkowe', rowData.additionalEquipment],
    ['Pakiety', rowData.equipmentPackages],
  ].filter(([, arr]) => Array.isArray(arr) && arr.length);

  const body = document.getElementById('previewModalBody');
  body.innerHTML = `
    <dl class="preview-dl">
      ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}
    </dl>
    ${equipRows.map(([heading, items]) => `
      <details class="preview-equip">
        <summary>${escapeHtml(heading)} <span class="preview-equip-count">(${items.length})</span></summary>
        <ul>${items.map((i) => `<li>${escapeHtml(String(i))}</li>`).join('')}</ul>
      </details>`).join('')}
  `;

  const modal = document.getElementById('previewModal');
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  setOverlay('previewModal');
  document.getElementById('closePreviewButton').focus();
}

function closePreviewModal() {
  const modal = document.getElementById('previewModal');
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (state.activeOverlay === 'previewModal') setOverlay(null);
}

function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', (event) => {
    state.searchQuery = event.target.value || '';
    applyFilters();
  });

  document.getElementById('clearFiltersButton').addEventListener('click', () => {
    state.searchQuery = '';
    state.selectedEquipmentSlugs = [];
    state.equipmentSearchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('equipmentSearchInput').value = '';
    applyFilters();
  });

  document.getElementById('clearEquipmentButton').addEventListener('click', () => {
    state.selectedEquipmentSlugs = [];
    applyFilters();
  });

  document.getElementById('equipmentSelectButton').addEventListener('click', () => {
    setEquipmentDropdownOpen(!state.equipmentDropdownOpen);
  });

  document.getElementById('equipmentSearchInput').addEventListener('input', (event) => {
    state.equipmentSearchQuery = event.target.value || '';
    renderEquipmentSelect();
  });

  document.getElementById('equipmentDropdown').addEventListener('click', (event) => {
    const removeSlug = event.target.getAttribute('data-remove-equipment');
    if (removeSlug) {
      toggleEquipmentSelection(removeSlug);
      return;
    }

    const optionSlug = event.target.closest('[data-equipment-option]');
    if (optionSlug) {
      toggleEquipmentSelection(optionSlug.getAttribute('data-equipment-option'));
    }
  });

  // Modal wyposażenia
  document.getElementById('closeEquipmentButton').addEventListener('click', closeEquipmentModal);
  document.getElementById('cancelEquipmentButton').addEventListener('click', closeEquipmentModal);
  document.getElementById('saveEquipmentButton').addEventListener('click', saveEquipmentModal);
  document.getElementById('equipmentAddButton').addEventListener('click', equipmentAddItem);
  document.getElementById('equipmentNewItem').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); equipmentAddItem(); }
  });
  document.querySelectorAll('[data-close-equip-modal="true"]').forEach((node) => {
    node.addEventListener('click', closeEquipmentModal);
  });
  document.querySelectorAll('[data-equip-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectEquipmentInputs();
      equipEdit.tab = btn.getAttribute('data-equip-tab');
      renderEquipmentTabButtons();
      renderEquipmentItems();
    });
  });
  document.getElementById('equipmentItemsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-index]');
    if (!btn) return;
    collectEquipmentInputs();
    const idx = Number(btn.getAttribute('data-delete-index'));
    if (equipEdit.tab === 'standard') {
      equipEdit.standard.splice(idx, 1);
    } else {
      equipEdit.additional.splice(idx, 1);
    }
    renderEquipmentItems();
  });

  document.getElementById('columnsButton').addEventListener('click', openDrawer);
  document.getElementById('closeColumnsButton').addEventListener('click', closeDrawer);
  document
    .querySelectorAll('[data-close-drawer="true"]')
    .forEach((node) => node.addEventListener('click', closeDrawer));
  document.getElementById('showAllColumnsButton').addEventListener('click', showAllColumns);
  document.getElementById('resetColumnsButton').addEventListener('click', resetColumnVisibility);

  document.getElementById('uploadButton').addEventListener('click', openImportModal);
  document.getElementById('closeImportButton').addEventListener('click', closeImportModal);
  document.getElementById('cancelImportButton').addEventListener('click', closeImportModal);
  document
    .querySelectorAll('[data-close-modal="true"]')
    .forEach((node) => node.addEventListener('click', closeImportModal));
  document.getElementById('confirmImportButton').addEventListener('click', submitImportBatch);

  // Modal usunięcia
  document.getElementById('closeDeleteButton').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDeleteButton').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteButton').addEventListener('click', confirmDelete);
  document.querySelectorAll('[data-close-delete-modal="true"]')
    .forEach((node) => node.addEventListener('click', closeDeleteModal));

  // Modal podglądu
  document.getElementById('closePreviewButton').addEventListener('click', closePreviewModal);
  document.querySelectorAll('[data-close-preview-modal="true"]')
    .forEach((node) => node.addEventListener('click', closePreviewModal));

  document.querySelectorAll('[data-import-tab]').forEach((button) => {
    button.addEventListener('click', () => setImportMode(button.getAttribute('data-import-tab')));
  });

  document.getElementById('modalUploadInput').addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    state.pendingFiles = files;
    document.getElementById('selectedFileName').textContent = getPendingFilesLabel(files);
  });

  document.getElementById('manualFileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    document.getElementById('manualFileName').textContent = file ? file.name : 'Nie wybrano pliku';
  });

  document.addEventListener('click', (event) => {
    if (
      state.equipmentDropdownOpen &&
      !event.target.closest('#equipmentSelect')
    ) {
      setEquipmentDropdownOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (state.activeOverlay === 'modal') {
      closeImportModal();
      return;
    }

    if (state.activeOverlay === 'equipModal') {
      closeEquipmentModal();
      return;
    }

    if (state.activeOverlay === 'drawer') {
      closeDrawer();
      return;
    }

    if (state.equipmentDropdownOpen) {
      setEquipmentDropdownOpen(false);
    }
  });
}

async function init() {
  bindEvents();
  bindTooltipEvents();

  try {
    await loadCars();
    updateStatus('Gotowe.');
  } catch (error) {
    updateStatus(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', init);
