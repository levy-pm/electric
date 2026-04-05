const state = {
  table: null,
  allItems: [],
  filteredItems: [],
  summary: {},
  selectedEquipmentSlug: '',
};

const leaderLabels = {
  bestPrice: 'Najlepsza cena',
  bestRange: 'Największy zasięg',
  bestBattery: 'Największa bateria',
  bestEquipment: 'Najbogatsze wyposażenie',
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

function rowBadgeFormatter(cell) {
  const badges = cell.getValue();
  if (!Array.isArray(badges) || badges.length === 0) {
    return '<span class="row-badge">Bez wyróżnienia</span>';
  }

  return badges.map((badge) => `<span class="row-badge">${badge}</span>`).join('');
}

function topRowFormatter(row) {
  row.getElement().classList.toggle('is-top-recommendation', Boolean(row.getData().isSuggestedTop));
}

function getColumns() {
  return [
    { title: 'Rekomendacja', field: 'recommendationBadges', formatter: rowBadgeFormatter, minWidth: 220, headerSort: false, responsive: 0 },
    { title: 'Model', field: 'displayName', minWidth: 280, headerFilter: 'input' },
    { title: 'Cena końcowa', field: 'totalPricePln', hozAlign: 'right', minWidth: 150, formatter: (cell) => currencyFormatter(cell.getValue()) },
    { title: 'Cena bazowa', field: 'basePricePln', hozAlign: 'right', minWidth: 150, formatter: (cell) => currencyFormatter(cell.getValue()), visible: false },
    { title: 'Zasięg WLTP', field: 'rangeWltpKm', hozAlign: 'right', minWidth: 130, formatter: (cell) => numberFormatter(cell.getValue(), 'km') },
    { title: 'Bateria', field: 'batteryCapacityKwh', hozAlign: 'right', minWidth: 120, formatter: (cell) => numberFormatter(cell.getValue(), 'kWh') },
    { title: 'Wyposażenie', field: 'equipmentScore', hozAlign: 'right', minWidth: 120, formatter: (cell) => numberFormatter(cell.getValue()) },
    { title: 'Pakiety', field: 'equipmentPackages', minWidth: 180, formatter: (cell) => textArrayFormatter(cell.getValue()) },
    { title: 'Wszystkie elementy', field: 'allEquipment', minWidth: 260, formatter: (cell) => textArrayFormatter(cell.getValue()), visible: false },
    { title: 'Opcje dodatkowe', field: 'additionalEquipmentCount', hozAlign: 'right', minWidth: 150, formatter: (cell) => numberFormatter(cell.getValue()) },
    { title: 'Moc', field: 'powerHp', hozAlign: 'right', minWidth: 110, formatter: (cell) => numberFormatter(cell.getValue(), 'KM') },
    { title: 'Moc kW', field: 'powerKw', hozAlign: 'right', minWidth: 110, formatter: (cell) => numberFormatter(cell.getValue(), 'kW'), visible: false },
    { title: 'Moment', field: 'torqueNm', hozAlign: 'right', minWidth: 120, formatter: (cell) => numberFormatter(cell.getValue(), 'Nm'), visible: false },
    { title: 'Zużycie energii', field: 'energyConsumptionKwh100km', hozAlign: 'right', minWidth: 170, formatter: (cell) => numberFormatter(cell.getValue(), 'kWh/100 km') },
    { title: 'Marka', field: 'brand', minWidth: 120, visible: false },
    { title: 'Model skrócony', field: 'model', minWidth: 120, visible: false },
    { title: 'Wersja', field: 'versionName', minWidth: 220, visible: false },
    { title: 'Kolor', field: 'exteriorColor', minWidth: 180, visible: false },
    { title: 'Felgi', field: 'wheels', minWidth: 200, visible: false },
    { title: 'Wnętrze', field: 'interiorTrim', minWidth: 220, visible: false },
    { title: 'Liczba miejsc', field: 'seats', hozAlign: 'right', minWidth: 120, visible: false },
    { title: 'Paliwo', field: 'fuelType', minWidth: 140, visible: false },
    { title: 'Homologacja', field: 'homologationStandard', minWidth: 140, visible: false },
    { title: 'CO₂', field: 'co2EmissionGkm', hozAlign: 'right', minWidth: 100, formatter: (cell) => numberFormatter(cell.getValue(), 'g/km'), visible: false },
    { title: 'Kod konfiguracji', field: 'configurationCode', minWidth: 160, visible: false },
    { title: 'Data konfiguracji', field: 'sourceDate', minWidth: 150, visible: false },
    { title: 'Notatki', field: 'notes', minWidth: 240, formatter: (cell) => textArrayFormatter(cell.getValue()), visible: false },
  ];
}

function createTable(items) {
  if (state.table) {
    state.table.replaceData(items);
    return;
  }

  state.table = new Tabulator('#tableContainer', {
    data: items,
    layout: 'fitDataStretch',
    movableColumns: true,
    responsiveLayout: 'collapse',
    responsiveLayoutCollapseStartOpen: false,
    placeholder: '<div class="empty-state">Brak konfiguracji. Wgraj pierwszy PDF, aby zbudować tabelę.</div>',
    rowFormatter: topRowFormatter,
    columns: getColumns(),
  });

  state.table.on('columnMoved', renderColumnsDrawerContent);
  state.table.on('columnVisibilityChanged', renderColumnsDrawerContent);
}

function renderColumnsDrawerContent() {
  if (!state.table) {
    return;
  }

  const columnsList = document.getElementById('columnsList');
  columnsList.innerHTML = '';

  state.table.getColumns().forEach((column) => {
    const field = column.getField();
    if (!field || field === 'recommendationScore') {
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
    });

    toggle.append(label, input);
    columnsList.append(toggle);
  });
}

function renderEquipmentFacets() {
  const container = document.getElementById('equipmentFilters');
  const facets = state.summary.equipmentFacets || [];
  container.innerHTML = '';

  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = `facet-chip${state.selectedEquipmentSlug ? '' : ' is-active'}`;
  allButton.textContent = 'Wszystkie';
  allButton.addEventListener('click', () => {
    state.selectedEquipmentSlug = '';
    applySearch(document.getElementById('searchInput').value);
  });
  container.append(allButton);

  facets.slice(0, 24).forEach((facet) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `facet-chip${state.selectedEquipmentSlug === facet.slug ? ' is-active' : ''}`;
    button.textContent = `${facet.label} (${facet.usageCount})`;
    button.addEventListener('click', () => {
      state.selectedEquipmentSlug = state.selectedEquipmentSlug === facet.slug ? '' : facet.slug;
      applySearch(document.getElementById('searchInput').value);
    });
    container.append(button);
  });
}

function updateStatus(message, isError = false) {
  const statusNode = document.getElementById('statusMessage');
  statusNode.textContent = message || '';
  statusNode.style.color = isError ? '#c73e1d' : '';
}

function updateSummary(items) {
  const topCarName = document.getElementById('topCarName');
  const topCarMeta = document.getElementById('topCarMeta');
  const topCarBadges = document.getElementById('topCarBadges');
  const leaderCards = document.getElementById('leaderCards');

  if (!items.length) {
    topCarName.textContent = 'Brak danych';
    topCarMeta.textContent = 'Dodaj pierwszy PDF konfiguratora, aby zobaczyć najlepszą propozycję.';
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
  ].filter(Boolean).join(' • ');

  topCarBadges.innerHTML = (top.recommendationBadges || []).map((badge) => `<span class="badge">${badge}</span>`).join('');

  const leaders = {};
  items.forEach((item) => {
    (item.recommendationBadges || []).forEach((badge) => {
      if (!leaders[badge]) {
        leaders[badge] = item;
      }
    });
  });

  leaderCards.innerHTML = Object.values(leaderLabels).map((label) => {
    const item = Object.values(leaders).find((leader) => (leader.recommendationBadges || []).includes(label));
    if (!item) {
      return '';
    }

    return `
      <article class="leader-card">
        <span class="eyebrow">${label}</span>
        <strong>${item.displayName || 'Bez nazwy'}</strong>
      </article>
    `;
  }).join('');
}

function applySearch(value) {
  const query = (value || '').trim().toLowerCase();
  state.filteredItems = state.allItems.filter((item) => {
    const searchMatch = !query || [
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
      .toLowerCase()
      .includes(query);

    const equipmentMatch = !state.selectedEquipmentSlug || (item.equipmentSlugs || []).includes(state.selectedEquipmentSlug);
    return searchMatch && equipmentMatch;
  });

  createTable(state.filteredItems);
  updateSummary(state.filteredItems);
  renderEquipmentFacets();
}

async function loadCars() {
  const response = await fetch('/api/cars');
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Nie udalo sie pobrac tabeli.');
  }

  state.allItems = payload.items || [];
  state.summary = payload.summary || {};
  applySearch(document.getElementById('searchInput').value);
  renderColumnsDrawerContent();
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('configurationPdf', file);
  updateStatus(`Analizuję plik: ${file.name}...`);

  const response = await fetch('/api/upload', { method: 'POST', body: formData });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Nie udalo sie przetworzyc PDF.');
  }

  updateStatus(payload.message || 'Plik zostal dodany.');
  await loadCars();
}

function openDrawer() {
  const drawer = document.getElementById('columnsDrawer');
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  const drawer = document.getElementById('columnsDrawer');
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
}

function bindEvents() {
  const searchInput = document.getElementById('searchInput');
  const uploadButton = document.getElementById('uploadButton');
  const uploadInput = document.getElementById('uploadInput');
  const columnsButton = document.getElementById('columnsButton');

  searchInput.addEventListener('input', (event) => applySearch(event.target.value));
  uploadButton.addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      await uploadFile(file);
    } catch (error) {
      updateStatus(error.message, true);
    } finally {
      uploadInput.value = '';
    }
  });

  columnsButton.addEventListener('click', openDrawer);
  document.getElementById('closeColumnsButton').addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-close-drawer="true"]').forEach((node) => node.addEventListener('click', closeDrawer));
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
