const DEFAULT_HIDDEN_FIELDS = new Set([
  'basePricePln',
  'allEquipment',
  'powerKw',
  'torqueNm',
  'brand',
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
  'additionalEquipmentCount',
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

// Etykiety odznak liderów — muszą być identyczne z BADGE_* w src/recommendation.js
const leaderLabels = {
  bestPrice: '💰 Najlepsza cena',
  bestRange: '🔋 Największy zasięg',
  bestBattery: '⚡ Największa bateria',
  bestPower: '🚀 Największa moc',
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

function numberFormatter(value, unit = '') {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const formatted = new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: 1,
  }).format(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

function textArrayFormatter(values) {
  return Array.isArray(values) && values.length ? values.join(', ') : '—';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function getColumns() {
  return [
    {
      title: 'Rekomendacja',
      field: 'recommendationBadges',
      formatter: rowBadgeFormatter,
      minWidth: 220,
      headerSort: false,
    },
    {
      title: 'Model',
      field: 'displayName',
      minWidth: 280,
    },
    {
      title: 'Konfiguracja',
      field: 'uploadId',
      minWidth: 120,
      headerSort: false,
      hozAlign: 'center',
      formatter: configurationFormatter,
      cellClick: (_event, cell) => {
        openConfiguration(cell.getRow().getData());
      },
    },
    {
      title: 'Cena końcowa',
      field: 'totalPricePln',
      minWidth: 150,
      hozAlign: 'right',
      formatter: (cell) => currencyFormatter(cell.getValue()),
    },
    {
      title: 'Cena bazowa',
      field: 'basePricePln',
      minWidth: 150,
      hozAlign: 'right',
      formatter: (cell) => currencyFormatter(cell.getValue()),
      visible: false,
    },
    {
      title: 'Zasięg WLTP',
      field: 'rangeWltpKm',
      minWidth: 130,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'km'),
    },
    {
      title: 'Bateria',
      field: 'batteryCapacityKwh',
      minWidth: 120,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'kWh'),
    },
    {
      title: 'Wyposażenie',
      field: 'equipmentScore',
      minWidth: 120,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue()),
    },
    {
      title: 'Pakiety',
      field: 'equipmentPackages',
      minWidth: 220,
      formatter: (cell) => textArrayFormatter(cell.getValue()),
    },
    {
      title: 'Wszystkie elementy',
      field: 'allEquipment',
      minWidth: 320,
      formatter: (cell) => textArrayFormatter(cell.getValue()),
      visible: false,
    },
    {
      title: 'Opcje dodatkowe',
      field: 'additionalEquipmentCount',
      minWidth: 150,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue()),
    },
    {
      title: 'Moc',
      field: 'powerHp',
      minWidth: 110,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'KM'),
    },
    {
      title: 'Moc kW',
      field: 'powerKw',
      minWidth: 110,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'kW'),
      visible: false,
    },
    {
      title: 'Moment',
      field: 'torqueNm',
      minWidth: 120,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'Nm'),
      visible: false,
    },
    {
      title: 'Zużycie energii',
      field: 'energyConsumptionKwh100km',
      minWidth: 180,
      hozAlign: 'right',
      formatter: (cell) => numberFormatter(cell.getValue(), 'kWh/100 km'),
    },
    { title: 'Marka', field: 'brand', minWidth: 120, visible: false },
    { title: 'Model skrócony', field: 'model', minWidth: 140, visible: false },
    { title: 'Wersja', field: 'versionName', minWidth: 220, visible: false },
    { title: 'Kolor', field: 'exteriorColor', minWidth: 180, visible: false },
    { title: 'Felgi', field: 'wheels', minWidth: 220, visible: false },
    { title: 'Wnętrze', field: 'interiorTrim', minWidth: 220, visible: false },
    {
      title: 'Liczba miejsc',
      field: 'seats',
      minWidth: 120,
      hozAlign: 'right',
      visible: false,
      formatter: (cell) => numberFormatter(cell.getValue()),
    },
    { title: 'Paliwo', field: 'fuelType', minWidth: 140, visible: false },
    { title: 'Homologacja', field: 'homologationStandard', minWidth: 160, visible: false },
    {
      title: 'CO₂',
      field: 'co2EmissionGkm',
      minWidth: 100,
      hozAlign: 'right',
      visible: false,
      formatter: (cell) => numberFormatter(cell.getValue(), 'g/km'),
    },
    { title: 'Kod konfiguracji', field: 'configurationCode', minWidth: 170, visible: false },
    { title: 'Data konfiguracji', field: 'sourceDate', minWidth: 160, visible: false },
    {
      title: 'Notatki',
      field: 'notes',
      minWidth: 280,
      visible: false,
      formatter: (cell) => textArrayFormatter(cell.getValue()),
    },
  ];
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

function createTable(items) {
  if (state.table) {
    state.table.replaceData(items);
    renderColumnsDrawerContent();
    return;
  }

  state.table = new Tabulator('#tableContainer', {
    data: items,
    layout: 'fitDataTable',
    movableColumns: true,
    placeholder: '<div class="empty-state">Brak konfiguracji. Dodaj pierwszy PDF albo link, aby zbudować tabelę.</div>',
    rowFormatter: topRowFormatter,
    columns: getColumns(),
  });

  state.table.on('tableBuilt', renderColumnsDrawerContent);
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
  topCarName.textContent = top.displayName || 'Bez nazwy';
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

  leaderCards.innerHTML = Object.values(leaderLabels)
    .map((label) => {
      const item = leaderByBadge[label]; // dopasowanie po identycznym stringu
      if (!item) {
        return '';
      }

      return `
        <article class="leader-card">
          <span class="eyebrow">${escapeHtml(label)}</span>
          <strong>${escapeHtml(item.displayName || 'Bez nazwy')}</strong>
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
