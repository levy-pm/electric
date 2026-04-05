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
  pendingFile: null,
  activeOverlay: null,
  drawerReturnFocus: null,
  modalReturnFocus: null,
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

  if (!Array.isArray(badges) || !badges.length) {
    return isTop
      ? '<span class="row-badge row-badge--recommended">Rekomendacja AI ★</span>'
      : '<span class="row-badge">Bez wyróżnienia</span>';
  }

  return badges.map((badge) => `<span class="row-badge">${escapeHtml(badge)}</span>`).join('');
}

function topRowFormatter(row) {
  row.getElement().classList.toggle('is-top-recommendation', Boolean(row.getData().isSuggestedTop));
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
    <button class="config-action-button" type="button" aria-label="${label}" title="${label}">
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
  return `<span class="cell-clamp cell-editable">${text ? escapeHtml(text) : 'â€”'}</span>`;
}

function editableArrayFormatter(values) {
  const text = Array.isArray(values) && values.length ? values.join(', ') : null;
  return `<span class="cell-clamp cell-editable">${text ? escapeHtml(text) : 'â€”'}</span>`;
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
  return `<button class="equip-action-btn" type="button" title="Edytuj wyposażenie">✏️ ${count} poz.</button>`;
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

    const tooltip = tooltipParts.length ? ` title="${escapeHtml(tooltipParts.join(' • '))}"` : '';
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
      minWidth: 200,
      widthGrow: 2,
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
  });
}

function renderColumnsDrawerContent() {
  const columnsList = document.getElementById('columnsList');
  columnsList.innerHTML = '';

  if (!state.table) {
    columnsList.innerHTML = '<div class="empty-state">Tabela pojawi się po załadowaniu danych.</div>';
    return;
  }

  state.table.getColumns().forEach((column) => {
    const field = column.getField();
    if (!field) {
      return;
    }

    const toggle = document.createElement('label');
    toggle.className = 'column-toggle';

    const label = document.createElement('span');
    label.textContent = column.getDefinition().title;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = column.isVisible();
    input.addEventListener('change', () => {
      if (input.checked) {
        column.show();
      } else {
        column.hide();
      }
      renderColumnsDrawerContent();
    });

    toggle.append(label, input);
    columnsList.append(toggle);
  });
}

function initStickyScroll() {
  const shell = document.querySelector('.table-scroll-shell');
  const hscroll = document.getElementById('tableHscroll');
  const track = document.getElementById('tableHscrollTrack');

  if (!shell || !hscroll || !track) {
    return;
  }

  function syncWidth() {
    track.style.width = shell.scrollWidth + 'px';
    // Wyrównaj pozycję po zmianie szerokości
    hscroll.scrollLeft = shell.scrollLeft;
  }

  let lockShell = false;
  let lockHscroll = false;

  shell.addEventListener('scroll', () => {
    if (lockHscroll) {
      return;
    }
    lockShell = true;
    hscroll.scrollLeft = shell.scrollLeft;
    lockShell = false;
  });

  hscroll.addEventListener('scroll', () => {
    if (lockShell) {
      return;
    }
    lockHscroll = true;
    shell.scrollLeft = hscroll.scrollLeft;
    lockHscroll = false;
  });

  // Obserwuj zmiany szerokości kontenera tabeli
  const observer = new ResizeObserver(syncWidth);
  observer.observe(shell);
  const container = document.getElementById('tableContainer');
  if (container) {
    observer.observe(container);
  }

  syncWidth();
}

function createTable(items) {
  if (state.table) {
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
  });

  state.table.on('tableBuilt', async () => {
    await enhanceEditableColumns();
    renderColumnsDrawerContent();
    initStickyScroll();
  });
  state.table.on('columnMoved', renderColumnsDrawerContent);
  state.table.on('columnVisibilityChanged', renderColumnsDrawerContent);
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
  topCarMeta.textContent = [
    currencyFormatter(top.totalPricePln),
    numberFormatter(top.rangeWltpKm, 'km'),
    top.batteryCapacityKwh ? numberFormatter(top.batteryCapacityKwh, 'kWh') : null,
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

  state.table.getColumns().forEach((column) => {
    const field = column.getField();
    if (!field) {
      return;
    }

    if (DEFAULT_HIDDEN_FIELDS.has(field)) {
      column.hide();
    } else {
      column.show();
    }
  });

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
  state.importMode = mode === 'url' ? 'url' : 'file';

  const isFile = state.importMode === 'file';
  document.getElementById('importFileTab').classList.toggle('is-active', isFile);
  document.getElementById('importUrlTab').classList.toggle('is-active', !isFile);
  document.getElementById('importFilePanel').hidden = !isFile;
  document.getElementById('importFilePanel').classList.toggle('is-active', isFile);
  document.getElementById('importUrlPanel').hidden = isFile;
  document.getElementById('importUrlPanel').classList.toggle('is-active', !isFile);
}

function resetImportForm() {
  state.pendingFile = null;
  document.getElementById('modalUploadInput').value = '';
  document.getElementById('configurationUrlInput').value = '';
  document.getElementById('selectedFileName').textContent = 'Nie wybrano pliku.';
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

async function loadCars() {
  const response = await fetch('/api/cars');
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Nie udało się pobrać tabeli.');
  }

  state.allItems = payload.items || [];
  state.summary = payload.summary || {};
  applyFilters();
  renderColumnsDrawerContent();
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('configurationPdf', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Nie udało się przetworzyć PDF.');
  }

  return payload;
}

async function importUrl(url) {
  const response = await fetch('/api/import-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Nie udało się przetworzyć linku.');
  }

  return payload;
}

async function submitImport() {
  const confirmButton = document.getElementById('confirmImportButton');
  confirmButton.disabled = true;

  try {
    let payload;

    if (state.importMode === 'file') {
      if (!state.pendingFile) {
        throw new Error('Najpierw wybierz plik PDF.');
      }

      updateImportStatus(`Analizuję plik: ${state.pendingFile.name}...`);
      payload = await uploadFile(state.pendingFile);
    } else {
      const url = document.getElementById('configurationUrlInput').value.trim();
      if (!url) {
        throw new Error('Wklej link do konfiguracji.');
      }

      updateImportStatus('Analizuję link do konfiguracji...');
      payload = await importUrl(url);
    }

    closeImportModal();
    updateStatus(payload.message || 'Konfiguracja została dodana.');
    await loadCars();
  } catch (error) {
    updateImportStatus(error.message, true);
  } finally {
    confirmButton.disabled = false;
  }
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
  document.getElementById('confirmImportButton').addEventListener('click', submitImport);

  document.querySelectorAll('[data-import-tab]').forEach((button) => {
    button.addEventListener('click', () => setImportMode(button.getAttribute('data-import-tab')));
  });

  document.getElementById('modalUploadInput').addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    state.pendingFile = file || null;
    document.getElementById('selectedFileName').textContent = file
      ? `Wybrano: ${file.name}`
      : 'Nie wybrano pliku.';
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

  try {
    await loadCars();
    updateStatus('Gotowe.');
  } catch (error) {
    updateStatus(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', init);
