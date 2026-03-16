const AUTH_USER = 'TamboID';
const AUTH_PASS = 'indrive.foodxjusto';

const state = {
  raw: null,
  isAuthenticated: localStorage.getItem('tambo_session') === 'ok',
  filters: {
    months: [],
    macroRegions: [],
    zones: [],
    areas: [],
    locals: [],
    deliveryTypes: [],
    distanceMin: null,
    distanceMax: null,
  },
  sort: { key: 'orders', dir: 'desc' },
  tableFilters: {},
  charts: {},
  map: null,
  mapLayers: {},
};

const $ = (id) => document.getElementById(id);
const number = (v, digits = 0) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(v || 0);
const money = (v) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 }).format(v || 0);
const pct = (v) => `${((v || 0) * 100).toFixed(1)}%`;
const km = (v) => v == null || Number.isNaN(v) ? '—' : `${Number(v).toFixed(2)} km`;
const minutes = (v) => v == null || Number.isNaN(v) ? '—' : `${Number(v).toFixed(1)} min`;
const escapeHtml = (str) => String(str ?? '').replace(/[&<>"]/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[m]));
const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined && v !== ''))];
const average = (arr) => arr.length ? arr.reduce((a,b) => a + b, 0) / arr.length : 0;
const sum = (arr) => arr.reduce((a,b) => a + (Number(b) || 0), 0);
const median = (arr) => {
  const clean = arr.filter((v) => Number.isFinite(v)).sort((a,b) => a-b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
};
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);

const safeDivision = (a, b) => b ? a / b : 0;
function weightedMedian(values, weights) {
  const pairs = values.map((v, i) => [v, weights[i]]).filter(([v, w]) => Number.isFinite(v) && Number.isFinite(w) && w > 0).sort((a,b) => a[0]-b[0]);
  if (!pairs.length) return null;
  const total = pairs.reduce((acc, [,w]) => acc + w, 0);
  let cumulative = 0;
  for (const [value, weight] of pairs) {
    cumulative += weight;
    if (cumulative >= total / 2) return value;
  }
  return pairs[pairs.length - 1][0];
}

function weightedQuantile(values, weights, quantile = 0.5) {
  const pairs = values.map((v, i) => [v, weights[i]])
    .filter(([v, w]) => Number.isFinite(v) && Number.isFinite(w) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  if (!pairs.length) return null;
  const target = pairs.reduce((acc, [,w]) => acc + w, 0) * quantile;
  let cumulative = 0;
  for (const [value, weight] of pairs) {
    cumulative += weight;
    if (cumulative >= target) return value;
  }
  return pairs[pairs.length - 1][0];
}

function weightedAverage(items, valueKey, weightKey) {
  const rows = items.filter((r) => Number.isFinite(r[valueKey]) && (r[weightKey] || 0) > 0);
  const totalWeight = sum(rows.map((r) => r[weightKey]));
  if (!totalWeight) return null;
  return rows.reduce((acc, r) => acc + r[valueKey] * r[weightKey], 0) / totalWeight;
}

function statusByCycle(v) {
  if (!Number.isFinite(v)) return { label: 'Sin SLA', className: 'sla-na', color: '#98a2b3' };
  if (v <= 35) return { label: 'Saludable', className: 'sla-good', color: '#14b86a' };
  if (v <= 45) return { label: 'En observación', className: 'sla-warn', color: '#f5a524' };
  return { label: 'Crítico', className: 'sla-bad', color: '#ef4444' };
}

async function loadData() {
  const res = await fetch('data/app-data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar la data del proyecto.');
  const raw = await res.text();
  const cleaned = raw
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null')
    .replace(/\b-Infinity\b/g, 'null');
  return JSON.parse(cleaned);
}

function setAuthMessage(message, ok = true) {
  const node = $('authMessage');
  node.textContent = message;
  node.className = `auth-message ${ok ? 'good' : 'bad'}`;
}

async function login() {
  const user = $('usernameInput').value.trim();
  const pass = $('passwordInput').value;
  if (user !== AUTH_USER || pass !== AUTH_PASS) return setAuthMessage('Usuario o clave inválidos.', false);
  localStorage.setItem('tambo_session', 'ok');
  state.isAuthenticated = true;
  await boot();
}

function logout() {
  localStorage.removeItem('tambo_session');
  state.isAuthenticated = false;
  $('app').classList.add('hidden');
  $('authGate').classList.remove('hidden');
}

async function boot() {
  try {
    state.raw = await loadData();
    hydrateHero();
    initFilters();
    initControls();
    initMap();
    $('authGate').classList.add('hidden');
    $('app').classList.remove('hidden');
    render();
  } catch (err) {
    console.error(err);
    logout();
    setAuthMessage(err.message || 'No se pudo abrir la aplicación.', false);
  }
}

function hydrateHero() {
  const m = state.raw.meta || {};
  $('bubbleNetworkTotal').textContent = number(m.networkTotalLocals);
  $('bubbleNetworkActive').textContent = number(m.networkActiveLocalsObserved || m.networkActiveLocals2025);
  $('bubbleDelivery').textContent = number(m.deliveryEnabledLocals);
  $('bubblePickup').textContent = number(m.pickupEnabledLocals);
  $('simUsers').value = m.defaultUsersActive || 2500000;
  $('simExposure').value = m.defaultExposurePct || 30;
  $('simCtr').value = m.defaultCtrPct || 5;
  $('simConversion').value = m.defaultConversionPct || 5;
  $('simDeliveryMix').value = 70;
  $('simOrdersDriver').value = m.defaultOrdersPerDriverDay || 8;
  $('simDays').value = m.defaultWorkingDays || 30;
  if ($('simTarget')) $('simTarget').value = m.defaultIncrementalTarget || 7500;
  if ($('simBuffer')) $('simBuffer').value = m.defaultOperationalBufferPct || 25;
  if ($('simPeakFactor')) $('simPeakFactor').value = m.defaultPeakFactor || 1.3;
}

function initControls() {
  if (!window.__tamboControlsBound) {
    $('loginBtn').addEventListener('click', login);
    $('logoutBtn').addEventListener('click', logout);
    $('passwordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('distanceMin').addEventListener('input', () => { state.filters.distanceMin = numOrNull($('distanceMin').value); render(); });
    $('distanceMax').addEventListener('input', () => { state.filters.distanceMax = numOrNull($('distanceMax').value); render(); });
    $('resetFiltersBtn').addEventListener('click', resetFilters);
    ['simUsers','simExposure','simCtr','simConversion','simDeliveryMix','simOrdersDriver','simDays','simTarget','simBuffer','simPeakFactor'].forEach((id) => { const node = $(id); if (node) node.addEventListener('input', () => render()); });
    ['toggleStores','toggleDemand','togglePriority','toggleNoCoverage'].forEach((id) => $(id).addEventListener('change', updateMapLayerVisibility));
    window.__tamboControlsBound = true;
  }
}

function resetFilters() {
  state.filters = { months: [], macroRegions: [], zones: [], areas: [], locals: [], deliveryTypes: [], distanceMin: null, distanceMax: null };
  state.tableFilters = {};
  $('distanceMin').value = '';
  $('distanceMax').value = '';
  initFilters();
  render();
}

function getFilterOptions() {
  const source = state.raw.localMonth || [];
  return {
    months: uniq(source.map((d) => d.month)).sort(),
    macroRegions: uniq(source.map((d) => d.macroRegion)).sort(),
    zones: uniq(source.map((d) => d.zone)).sort(),
    areas: uniq(source.map((d) => d.area)).sort(),
    locals: uniq(source.map((d) => d.localName)).sort((a,b) => a.localeCompare(b)),
    deliveryTypes: ['Delivery', 'Retiro'],
  };
}

function makeMultiFilter(key, title, items) {
  const selected = state.filters[key] || [];
  const meta = selected.length ? `${selected.length} seleccionadas` : 'Todas';
  return `
    <details class="multi-select" open>
      <summary>
        <span class="meta"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span>
        <span>▾</span>
      </summary>
      <div class="multi-options">
        <label><input type="checkbox" data-filter="${key}" value="__all__" ${selected.length === 0 ? 'checked' : ''}> Todas</label>
        ${items.map((item) => `<label><input type="checkbox" data-filter="${key}" value="${escapeHtml(item)}" ${selected.includes(item) ? 'checked' : ''}> ${escapeHtml(item)}</label>`).join('')}
      </div>
    </details>`;
}

function initFilters() {
  const o = getFilterOptions();
  $('filtersGrid').innerHTML = [
    makeMultiFilter('months', 'Mes-año', o.months),
    makeMultiFilter('macroRegions', 'Lima / Provincia', o.macroRegions),
    makeMultiFilter('deliveryTypes', 'Tipo de entrega', o.deliveryTypes),
    makeMultiFilter('zones', 'Zona', o.zones),
    makeMultiFilter('areas', 'Área', o.areas),
    makeMultiFilter('locals', 'Local', o.locals),
  ].join('');
  document.querySelectorAll('[data-filter]').forEach((node) => node.addEventListener('change', onFilterChange));
}

function onFilterChange(e) {
  const { filter: key } = e.target.dataset;
  const { value } = e.target;
  if (value === '__all__') {
    state.filters[key] = [];
    initFilters();
    render();
    return;
  }
  const set = new Set(state.filters[key] || []);
  if (e.target.checked) set.add(value); else set.delete(value);
  state.filters[key] = [...set];
  initFilters();
  render();
}

function matchesMulti(record, values, key) {
  return !values.length || values.includes(record[key]);
}

function adjustedRow(row) {
  const selected = state.filters.deliveryTypes;
  const all = !selected.length || selected.length === 2;
  const delivery = selected.includes('Delivery');
  const pickup = selected.includes('Retiro');
  const deliveryOrders = Number(row.deliveryOrders) || 0;
  const pickupOrders = Number(row.pickupOrders) || 0;
  const avgTicket = Number(row.avgTicket) || ((Number(row.orders) || 0) ? (Number(row.gmv) || 0) / (Number(row.orders) || 1) : 0);

  if (all) {
    return {
      ...row,
      typeSelection: 'all',
      ordersAdj: Number(row.orders) || 0,
      gmvAdj: Number(row.gmv) || 0,
      projectOrdersAdj: Number(row.projectOrders) || 0,
      activeDriversAdj: Number(row.activeDrivers) || 0,
      hasDeliveryAdj: deliveryOrders > 0,
      hasPickupAdj: pickupOrders > 0,
      coverageAdj: row.coverageType,
      avgDistanceKmAdj: Number(row.avgDistance || 0) / 1000,
    };
  }

  if (delivery && !pickup) {
    return {
      ...row,
      typeSelection: 'delivery',
      ordersAdj: deliveryOrders,
      gmvAdj: deliveryOrders * avgTicket,
      projectOrdersAdj: Number(row.projectOrders) || 0,
      activeDriversAdj: Number(row.activeDrivers) || 0,
      hasDeliveryAdj: deliveryOrders > 0,
      hasPickupAdj: false,
      coverageAdj: 'Solo Delivery',
      avgDistanceKmAdj: Number(row.avgDistance || 0) / 1000,
    };
  }

  return {
    ...row,
    typeSelection: 'pickup',
    ordersAdj: pickupOrders,
    gmvAdj: pickupOrders * avgTicket,
    projectOrdersAdj: 0,
    activeDriversAdj: 0,
    hasDeliveryAdj: false,
    hasPickupAdj: pickupOrders > 0,
    coverageAdj: 'Solo Retiro',
    cycleP50: null,
    cycleP90: null,
    actP50: null,
    actP90: null,
    acceptP50: null,
    acceptP90: null,
    toStoreP50: null,
    toStoreP90: null,
    waitP50: null,
    waitP90: null,
    lastMileP50: null,
    lastMileP90: null,
    avgDistanceKmAdj: 0,
  };
}

function filteredRows() {
  const f = state.filters;
  return (state.raw.localMonth || [])
    .filter((row) => matchesMulti(row, f.months, 'month')
      && matchesMulti(row, f.macroRegions, 'macroRegion')
      && matchesMulti(row, f.zones, 'zone')
      && matchesMulti(row, f.areas, 'area')
      && matchesMulti(row, f.locals, 'localName'))
    .map(adjustedRow)
    .filter((row) => row.ordersAdj > 0)
    .filter((row) => (f.distanceMin == null || row.avgDistanceKmAdj >= f.distanceMin)
      && (f.distanceMax == null || row.avgDistanceKmAdj <= f.distanceMax));
}

function aggregatePoints(rows) {
  const byLocal = new Map();
  rows.forEach((row) => {
    const point = (state.raw.localPoints || []).find((p) => p.localId === row.localId) || {};
    const key = row.localId;
    if (!byLocal.has(key)) {
      byLocal.set(key, {
        localId: row.localId,
        localName: row.localName,
        macroRegion: row.macroRegion,
        zone: row.zone,
        area: row.area,
        city: row.city,
        coverageType: row.coverageAdj,
        deliveryEnabled: row.hasDeliveryAdj,
        pickupEnabled: row.hasPickupAdj,
        lat: point.lat,
        lng: point.lng,
        orders: 0,
        gmv: 0,
        projectOrders: 0,
        drivers: 0,
        distances: [],
        metricBuckets: {
          cycleP50: { values: [], weights: [] }, cycleP90: { values: [], weights: [] },
          actP50: { values: [], weights: [] }, actP90: { values: [], weights: [] },
          acceptP50: { values: [], weights: [] }, acceptP90: { values: [], weights: [] },
          toStoreP50: { values: [], weights: [] }, toStoreP90: { values: [], weights: [] },
          waitP50: { values: [], weights: [] }, waitP90: { values: [], weights: [] },
          lastMileP50: { values: [], weights: [] }, lastMileP90: { values: [], weights: [] },
        },
      });
    }
    const bucket = byLocal.get(key);
    bucket.orders += row.ordersAdj;
    bucket.gmv += row.gmvAdj;
    bucket.projectOrders += row.projectOrdersAdj;
    bucket.drivers += row.activeDriversAdj;
    if (Number.isFinite(row.avgDistanceKmAdj) && row.avgDistanceKmAdj > 0) bucket.distances.push(row.avgDistanceKmAdj);
    const weight = Number(row.deliveryOrders) || Number(row.ordersAdj) || 0;
    Object.keys(bucket.metricBuckets).forEach((field) => {
      if (Number.isFinite(row[field]) && weight > 0) {
        bucket.metricBuckets[field].values.push(row[field]);
        bucket.metricBuckets[field].weights.push(weight);
      }
    });
  });
  return [...byLocal.values()].map((p) => {
    const metrics = {};
    Object.entries(p.metricBuckets).forEach(([field, pack]) => {
      const quantile = field.endsWith('P90') ? 0.9 : 0.5;
      metrics[field] = weightedQuantile(pack.values, pack.weights, quantile);
    });
    return {
      ...p,
      ...metrics,
      avgTicket: p.orders ? p.gmv / p.orders : 0,
      avgDistanceKm: average(p.distances),
      sla: statusByCycle(metrics.cycleP50),
    };
  });
}

function summarize(rows, points) {
  const orders = sum(rows.map((r) => r.ordersAdj));
  const gmv = sum(rows.map((r) => r.gmvAdj));
  const deliveryOrders = sum(rows.map((r) => r.typeSelection === 'pickup' ? 0 : (Number(r.deliveryOrders) || 0)));
  const pickupOrders = sum(rows.map((r) => r.typeSelection === 'delivery' ? 0 : (Number(r.pickupOrders) || 0)));
  const projectOrders = sum(rows.map((r) => r.projectOrdersAdj));
  const completeRate = weightedAverage(rows.map((r) => ({ completeRate: Number(r.completeRate) || 0, weight: r.ordersAdj })), 'completeRate', 'weight') || 0;
  const projectCompleteRate = weightedAverage(rows.map((r) => ({ completeRate: Number(r.projectCompleteRate) || Number(r.completeRate) || 0, weight: r.projectOrdersAdj })), 'completeRate', 'weight') || 0;
  const monthMap = new Map();
  rows.forEach((r) => {
    const current = monthMap.get(r.month) || { orders: 0, gmv: 0, drivers: 0 };
    current.orders += r.ordersAdj;
    current.gmv += r.gmvAdj;
    current.drivers += r.activeDriversAdj;
    monthMap.set(r.month, current);
  });
  const monthly = [...monthMap.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  const uniqueMonths = monthly.length || 1;

  return {
    orders,
    gmv,
    avgTicket: orders ? gmv / orders : 0,
    completeRate,
    projectOrders,
    projectCompleteRate,
    deliveryOrders,
    pickupOrders,
    cycleP50: weightedQuantile(points.map((p) => p.cycleP50), points.map((p) => p.orders), 0.5),
    cycleP90: weightedQuantile(points.map((p) => p.cycleP90), points.map((p) => p.orders), 0.9),
    actP50: weightedQuantile(points.map((p) => p.actP50), points.map((p) => p.orders), 0.5),
    actP90: weightedQuantile(points.map((p) => p.actP90), points.map((p) => p.orders), 0.9),
    acceptP50: weightedQuantile(points.map((p) => p.acceptP50), points.map((p) => p.orders), 0.5),
    acceptP90: weightedQuantile(points.map((p) => p.acceptP90), points.map((p) => p.orders), 0.9),
    toStoreP50: weightedQuantile(points.map((p) => p.toStoreP50), points.map((p) => p.orders), 0.5),
    toStoreP90: weightedQuantile(points.map((p) => p.toStoreP90), points.map((p) => p.orders), 0.9),
    waitP50: weightedQuantile(points.map((p) => p.waitP50), points.map((p) => p.orders), 0.5),
    waitP90: weightedQuantile(points.map((p) => p.waitP90), points.map((p) => p.orders), 0.9),
    lastMileP50: weightedQuantile(points.map((p) => p.lastMileP50), points.map((p) => p.orders), 0.5),
    lastMileP90: weightedQuantile(points.map((p) => p.lastMileP90), points.map((p) => p.orders), 0.9),
    avgDistanceKm: weightedAverage(points.map((p) => ({ distance: p.avgDistanceKm, weight: p.orders })), 'distance', 'weight') || 0,
    activeDrivers: uniqueMonths ? sum(monthly.map((m) => m[1].drivers)) / uniqueMonths : 0,
    activeLocals: points.length,
    activeLocalsDeliveryObserved: points.filter((p) => p.deliveryEnabled && p.orders > 0).length,
    activeLocalsDeliveryConfigured: points.filter((p) => p.deliveryEnabled).length,
    activeLocalsPickup: points.filter((p) => p.pickupEnabled).length,
    avgOrdersMonth: uniqueMonths ? orders / uniqueMonths : 0,
    avgGmvMonth: uniqueMonths ? gmv / uniqueMonths : 0,
    months: uniqueMonths,
    monthly,
  };
}

function grouped(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key] || 'Sin dato';
    const item = map.get(k) || { name: k, orders: 0, gmv: 0, projectOrders: 0, drivers: 0, locals: new Set(), cycle: [] };
    item.orders += r.ordersAdj;
    item.gmv += r.gmvAdj;
    item.projectOrders += r.projectOrdersAdj;
    item.drivers += r.activeDriversAdj;
    item.locals.add(r.localId);
    if (Number.isFinite(r.cycleP50)) item.cycle.push(r.cycleP50);
    map.set(k, item);
  });
  return [...map.values()].map((v) => ({ ...v, locals: v.locals.size, cycleP50: median(v.cycle) }));
}

function render() {
  const rows = filteredRows();
  const points = aggregatePoints(rows);
  const summary = summarize(rows, points);
  renderKpis(summary);
  renderExecutive(summary, rows, points);
  renderHighlights(summary, rows, points);
  renderNarratives(summary, rows, points);
  renderCharts(summary, rows, points);
  renderMap(points, rows);
  renderTable(points);
  renderSimulator(rows, summary);
}

function renderKpis(summary) {
  const cards = [
    { label: 'Orders', value: number(summary.orders), sub: `${number(summary.avgOrdersMonth)} promedio mensual` },
    { label: 'GMV', value: money(summary.gmv), sub: `${money(summary.avgGmvMonth)} promedio mensual` },
    { label: 'Ticket promedio', value: money(summary.avgTicket), sub: `${pct(summary.deliveryOrders / Math.max(summary.orders, 1))} mix delivery` },
    { label: '% completados', value: pct(summary.completeRate), sub: `${pct(summary.projectCompleteRate)} completados en el módulo proyecto` },
    { label: 'Ciclo típico', value: minutes(summary.cycleP50), sub: `P50 recalculado · P90 ${minutes(summary.cycleP90)}` },
    { label: 'Distancia promedio', value: km(summary.avgDistanceKm), sub: 'Se recalcula con el filtro de distancia' },
    { label: 'Locales con delivery observado', value: number(summary.activeLocalsDeliveryObserved), sub: `${number(summary.activeLocalsDeliveryConfigured)} configurados para delivery y ${number(summary.activeLocals)} activos totales` },
    { label: 'Drivers únicos activos', value: number(summary.activeDrivers), sub: 'Promedio mensual de repartidores distintos observados' },
  ];
  $('kpiGrid').innerHTML = cards.map((card) => `
    <article class="kpi-card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${card.value}</div>
      <div class="sub">${escapeHtml(card.sub)}</div>
    </article>`).join('');
}


function renderExecutive(summary, rows, points) {
  const users = Number($('simUsers')?.value) || 0;
  const exposurePct = (Number($('simExposure')?.value) || 0) / 100;
  const ctrPct = (Number($('simCtr')?.value) || 0) / 100;
  const conversionPct = (Number($('simConversion')?.value) || 0) / 100;
  const deliveryMixPct = (Number($('simDeliveryMix')?.value) || 0) / 100;
  const ordersDriver = Number($('simOrdersDriver')?.value) || 1;
  const days = Number($('simDays')?.value) || 30;
  const target = Number($('simTarget')?.value) || 7500;

  const baseTotalMonth = summary.avgOrdersMonth || 0;
  const baseDeliveryMonth = safeDivision(summary.deliveryOrders, Math.max(summary.months || 1, 1));
  const baseDriversDaily = safeDivision(baseDeliveryMonth, Math.max(ordersDriver * days, 1));
  const incrementalOrders = users * exposurePct * ctrPct * conversionPct;
  const incrementalDelivery = incrementalOrders * deliveryMixPct;
  const incrementalDriversDaily = safeDivision(incrementalDelivery, Math.max(ordersDriver * days, 1));
  const totalDriversDaily = baseDriversDaily + incrementalDriversDaily;
  const gapToTarget = Math.max(target - baseTotalMonth, 0);
  const readiness = summary.cycleP50 == null ? 'Sin lectura delivery suficiente' : summary.cycleP50 <= 35 ? 'Lista para escalar' : summary.cycleP50 <= 45 ? 'Escalar con cuidado' : 'Requiere estabilización';
  const bestZone = grouped(rows, 'zone').sort((a,b) => (b.projectOrders || b.orders) - (a.projectOrders || a.orders))[0];

  $('executiveStrip').innerHTML = `
    <div class="executive-card accent-blue">
      <span class="eyebrow-mini">Base actual mensual</span>
      <strong>${number(baseTotalMonth)}</strong>
      <span>órdenes promedio por mes dentro del filtro actual, considerando delivery y retiro.</span>
    </div>
    <div class="executive-card accent-red">
      <span class="eyebrow-mini">Incremental simulado</span>
      <strong>${number(incrementalOrders)}</strong>
      <span>órdenes incrementales por mes con la configuración actual del simulador; se suman a la base, no la reemplazan.</span>
    </div>
    <div class="executive-card accent-lime">
      <span class="eyebrow-mini">Capacidad total requerida</span>
      <strong>${number(totalDriversDaily, 1)}</strong>
      <span>drivers activos promedio por día para sostener base + incremento, asumiendo ${number(ordersDriver, 1)} órdenes delivery por driver por día.</span>
    </div>
    <div class="executive-card accent-dark">
      <span class="eyebrow-mini">Lectura recomendada</span>
      <strong>${escapeHtml(readiness)}</strong>
      <span>${bestZone ? `Primera zona a revisar: ${escapeHtml(bestZone.name)}.` : 'Ajusta filtros para ver prioridad por zona.'} Gap a la meta incremental: ${number(Math.max(target - incrementalOrders, 0))} órdenes/mes.</span>
    </div>`;

  const zoneRows = grouped(rows.filter((r) => r.typeSelection !== 'pickup'), 'zone').sort((a,b) => (b.projectOrders || b.orders) - (a.projectOrders || a.orders));
  const best = zoneRows[0];
  const second = zoneRows[1];
  const targetNode = $('projectComparison');
  if (targetNode) {
    targetNode.innerHTML = `
      <div class="executive-card accent-blue">
        <span class="eyebrow-mini">Base delivery mensual</span>
        <strong>${number(baseDeliveryMonth)}</strong>
        <span>${number(baseDriversDaily, 1)} drivers/día estimados para la operación delivery regular bajo el supuesto actual de productividad.</span>
      </div>
      <div class="executive-card accent-red">
        <span class="eyebrow-mini">Delivery incremental</span>
        <strong>${number(incrementalDelivery)}</strong>
        <span>${number(incrementalDriversDaily, 1)} drivers/día adicionales para capturar el volumen incremental configurado.</span>
      </div>
      <div class="executive-card accent-lime">
        <span class="eyebrow-mini">Zonas con mayor tracción</span>
        <strong>${escapeHtml(best?.name || '—')}</strong>
        <span>${best ? `${number(best.projectOrders || best.orders)} órdenes y ${number(best.locals)} locales.` : 'Sin señal suficiente.'}${second ? ` Segunda zona: ${escapeHtml(second.name)}.` : ''}</span>
      </div>
      <div class="executive-card accent-dark">
        <span class="eyebrow-mini">Meta incremental inDrive</span>
        <strong>${number(target)}</strong>
        <span>El foco es capturar ${number(target)} órdenes incrementales y preparar capacidad para base actual + incremento total del proyecto.</span>
      </div>`;
  }
}

function renderHighlights(summary, rows, points) {
  const topZone = grouped(rows, 'zone').sort((a,b) => b.projectOrders - a.projectOrders)[0];
  const topArea = grouped(rows, 'area').sort((a,b) => b.orders - a.orders)[0];
  const topLocal = [...points].sort((a,b) => b.orders - a.orders)[0];
  const worstLocal = [...points].filter((p) => Number.isFinite(p.cycleP50)).sort((a,b) => b.cycleP50 - a.cycleP50)[0];
  const mixText = `${pct(summary.deliveryOrders / Math.max(summary.orders, 1))} delivery / ${pct(summary.pickupOrders / Math.max(summary.orders, 1))} retiro`;
  const highlights = [
    { title: 'Escala del filtro actual', text: `${number(summary.orders)} órdenes y ${money(summary.gmv)} de GMV, con ${number(summary.activeLocals)} locales activos y ${number(summary.activeLocalsDeliveryObserved)} locales con delivery observado en ${number(summary.months)} meses.` },
    { title: 'Mix de atención', text: `El negocio filtrado corre con un mix ${mixText}; cambia inmediatamente con el filtro de tipo de entrega.` },
    { title: 'Dónde está la mayor oportunidad', text: topZone ? `${topZone.name} lidera el potencial del proyecto con ${number(topZone.projectOrders || topZone.orders)} órdenes relevantes y ${number(topZone.locals)} locales activos.` : 'No hay suficiente base delivery para estimar oportunidad.' },
    { title: 'Principal polo de volumen', text: topArea ? `${topArea.name} concentra ${number(topArea.orders)} órdenes del e-commerce filtrado, por lo que debería seguirse muy de cerca al abrir visibilidad.` : 'Sin datos suficientes.' },
    { title: 'Local ancla', text: topLocal ? `${topLocal.localName} es el local de mayor volumen con ${number(topLocal.orders)} órdenes y ticket de ${money(topLocal.avgTicket)}.` : 'Sin locales activos con el filtro actual.' },
    { title: 'Foco de riesgo', text: worstLocal ? `${worstLocal.localName} tiene el ciclo P50 más exigente en ${minutes(worstLocal.cycleP50)}.` : 'No hay datos de SLA para el filtro actual.' },
  ];
  $('highlightsGrid').innerHTML = highlights.map((h) => `<div class="highlight"><strong>${escapeHtml(h.title)}</strong><span>${escapeHtml(h.text)}</span></div>`).join('');
}

function renderNarratives(summary, rows, points) {
  const zones = grouped(rows, 'zone').sort((a,b) => (b.projectOrders + b.orders) - (a.projectOrders + a.orders));
  const riskPoints = [...points].filter((p) => p.deliveryEnabled && Number.isFinite(p.cycleP50)).sort((a,b) => b.cycleP50 - a.cycleP50).slice(0, 3);
  const bestPoints = [...points].filter((p) => p.deliveryEnabled && Number.isFinite(p.cycleP50)).sort((a,b) => a.cycleP50 - b.cycleP50).slice(0, 3);
  const topPriority = zones.slice(0, 3).map((z) => `${z.name}: ${number(z.projectOrders || z.orders)} órdenes y ${number(z.locals)} locales`).join('; ');
  const prepTarget = 12;
  const waitTarget = 3;
  const cycleTarget = 35;

  $('overviewNarrative').innerHTML = `
    <p>La red total considerada es de <strong>${number(state.raw.meta.networkTotalLocals)}</strong> locales Tambo. En el filtro actual se observan <strong>${number(summary.activeLocals)}</strong> locales con movimiento, de los cuales <strong>${number(summary.activeLocalsDeliveryObserved)}</strong> registran pedidos delivery observados y <strong>${number(summary.activeLocalsPickup)}</strong> registran retiro.</p>
    <p>El negocio corre a un ticket típico de <strong>${money(summary.avgTicket)}</strong>, con <strong>${pct(summary.completeRate)}</strong> de pedidos completados y un ciclo delivery típico recalculado de <strong>${minutes(summary.cycleP50)}</strong> (P90: <strong>${minutes(summary.cycleP90)}</strong>).</p><p>La lectura operativa usa timestamps recalculados por pedido y excluye duraciones negativas, secuencias imposibles y registros implausibles.</p>
    <p>El mix filtrado se reparte en <strong>${pct(summary.deliveryOrders / Math.max(summary.orders, 1))}</strong> delivery y <strong>${pct(summary.pickupOrders / Math.max(summary.orders, 1))}</strong> retiro, lo que permite dimensionar el proyecto como crecimiento incremental sobre el e-commerce completo.</p>`;

  $('opportunityNarrative').innerHTML = `
    <p>La oportunidad se mide como <strong>órdenes incrementales</strong> que inDrive puede sumar sobre la base actual del e-commerce. En el filtro actual la operación corre a <strong>${number(summary.avgOrdersMonth)}</strong> órdenes promedio por mes y el módulo proyecto ya muestra <strong>${number(summary.projectOrders)}</strong> órdenes delivery observadas como señal inicial.</p>
    <p>Las zonas más relevantes para abrir visibilidad son: <strong>${escapeHtml(topPriority || 'sin suficiente señal')}</strong>.</p>
    <p>La conversación clave ya no es solo “cuántas órdenes podríamos generar”, sino <strong>si la red tiene capacidad para absorber base + incremento sin deteriorar el SLA</strong>.</p>`;

  $('activationNarrative').innerHTML = `
    <p>Prioriza activación donde coinciden cuatro señales: volumen base alto, cantidad de locales activos, señal de proyecto y SLA manejable. Esa combinación maximiza órdenes incrementales sin tensionar de más la red.</p>
    <ul>${zones.slice(0, 4).map((z, i) => `<li><strong>${i + 1}. ${escapeHtml(z.name)}</strong>: ${number(z.orders)} órdenes base, ${number(z.locals)} locales y ${minutes(z.cycleP50)} de ciclo delivery típico.</li>`).join('')}</ul>
    <p>La prioridad debería abrirse por olas: primero zonas listas para escalar, luego zonas con tracción pero necesidad de refuerzo, y al final zonas con gaps operativos o cobertura débil.</p>`;

  $('riskNarrative').innerHTML = `
    <p>Antes de abrir más tráfico, protege los puntos con señales de saturación o tiempos altos. El objetivo es que el volumen incremental no deteriore la base actual.</p>
    <ul>${riskPoints.map((p) => `<li><strong>${escapeHtml(p.localName)}</strong>: ${minutes(p.cycleP50)} de ciclo y ${number(p.orders)} órdenes.</li>`).join('') || '<li>Sin riesgo operativo visible con el filtro actual.</li>'}</ul>
    <p>Referencias sugeridas para escalar con control: preparación interna ≤ <strong>${prepTarget} min</strong>, espera del driver en tienda ≤ <strong>${waitTarget} min</strong> P50 y ciclo total ≤ <strong>${cycleTarget} min</strong> P50. Los locales con mejor readiness hoy son ${bestPoints.map((p) => `<strong>${escapeHtml(p.localName)}</strong>`).join(', ') || 'los que mantengan ciclo por debajo de 35 min y volumen consistente'}.</p>`;

  $('coverageNarrative').innerHTML = `
    <p><span class="legend-dot" style="background:#14b86a"></span><strong>Verde</strong>: locales con SLA saludable.</p>
    <p><span class="legend-dot" style="background:#f5a524"></span><strong>Ámbar</strong>: locales en observación.</p>
    <p><span class="legend-dot" style="background:#ef4444"></span><strong>Rojo</strong>: locales críticos o sin delivery observado en el filtro actual. Eso puede significar que hoy operan solo retiro, que no registran pedidos delivery en la ventana elegida o que no hay lectura operativa suficiente tras la limpieza de tiempos.</p>
    <p><span class="legend-dot" style="background:rgba(22,93,255,.45)"></span><strong>Azul</strong>: puntos de demanda potencial observada.</p>`;
}

function destroyChart(key) {
  if (state.charts[key]) state.charts[key].destroy();
}

function createChart(key, canvasId, config) {
  destroyChart(key);
  state.charts[key] = new Chart($(canvasId), {
    ...config,
    plugins: [centerTextPlugin],
  });
}

const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart) {
    const text = chart?.options?.plugins?.centerText?.text;
    if (!text || chart.config.type !== 'doughnut') return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const x = meta.data[0].x;
    const y = meta.data[0].y;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((line, idx) => {
      ctx.font = idx === 0 ? '600 12px Inter, sans-serif' : '700 20px Inter, sans-serif';
      ctx.fillStyle = idx === 0 ? '#667085' : '#101c36';
      ctx.fillText(line, x, y - 8 + idx * 18);
    });
    ctx.restore();
  }
};

function renderCharts(summary, rows, points) {
  const monthly = summary.monthly;
  createChart('monthly', 'monthlyChart', {
    type: 'bar',
    data: {
      labels: monthly.map(([m]) => m),
      datasets: [
        { type: 'bar', label: 'Orders', data: monthly.map(([,v]) => v.orders), backgroundColor: 'rgba(22,93,255,.75)', borderRadius: 8, yAxisID: 'y' },
        { type: 'line', label: 'GMV', data: monthly.map(([,v]) => v.gmv), borderColor: '#d61f26', backgroundColor: '#d61f26', tension: .3, yAxisID: 'y1' },
      ],
    },
    options: baseChartOptions({ dualAxis: true }),
  });

  const deliveryMixPct = summary.orders ? ((summary.deliveryOrders / summary.orders) * 100).toFixed(1) : '0.0';

  createChart('mix', 'mixChart', {
    type: 'doughnut',
    data: {
      labels: ['Delivery', 'Retiro'],
      datasets: [{ data: [summary.deliveryOrders, summary.pickupOrders], backgroundColor: ['rgba(22,93,255,.82)', 'rgba(152,193,29,.8)'], borderWidth: 0 }],
    },
    options: doughnutOptions(`% Delivery\n${deliveryMixPct}%`),
  });

  const coverageCounts = [
    points.filter((p) => p.deliveryEnabled && p.pickupEnabled).length,
    points.filter((p) => p.deliveryEnabled && !p.pickupEnabled).length,
    points.filter((p) => !p.deliveryEnabled && p.pickupEnabled).length,
  ];
  createChart('coverage', 'coverageChart', {
    type: 'bar',
    data: {
      labels: ['Delivery + Retiro', 'Solo Delivery', 'Sin delivery observado'],
      datasets: [{ label: 'Locales', data: coverageCounts, backgroundColor: ['rgba(22,93,255,.82)', 'rgba(214,31,38,.82)', 'rgba(152,193,29,.82)'], borderRadius: 8 }],
    },
    options: baseChartOptions(),
  });

  const topAreas = grouped(rows, 'area').sort((a,b) => (b.projectOrders || b.orders) - (a.projectOrders || a.orders)).slice(0, 8);
  createChart('priority', 'priorityChart', {
    type: 'bar',
    data: {
      labels: topAreas.map((a) => trim(a.name, 20)),
      datasets: [{ label: 'Órdenes proyecto / proxy', data: topAreas.map((a) => a.projectOrders || a.orders), backgroundColor: 'rgba(22,93,255,.78)', borderRadius: 8 }],
    },
    options: baseChartOptions({ indexAxis: 'y' }),
  });

  createChart('cycle', 'cycleChart', {
    type: 'bar',
    data: {
      labels: ['Activación', 'Aceptación', 'Llegada tienda', 'Espera tienda', 'Última milla', 'Ciclo total'],
      datasets: [
        { label: 'P50 (min)', data: [summary.actP50, summary.acceptP50, summary.toStoreP50, summary.waitP50, summary.lastMileP50, summary.cycleP50], backgroundColor: 'rgba(22,93,255,.75)', borderRadius: 8 },
        { label: 'P90 (min)', data: [summary.actP90, summary.acceptP90, summary.toStoreP90, summary.waitP90, summary.lastMileP90, summary.cycleP90], backgroundColor: 'rgba(214,31,38,.68)', borderRadius: 8 },
      ],
    },
    options: baseChartOptions(),
  });

  createChart('drivers', 'driversChart', {
    type: 'line',
    data: {
      labels: monthly.map(([m]) => m),
      datasets: [{ label: 'Drivers activos', data: monthly.map(([,v]) => v.drivers), borderColor: '#98c11d', backgroundColor: 'rgba(152,193,29,.2)', tension: .35, fill: true }],
    },
    options: baseChartOptions(),
  });

  const rank = [...points].sort((a,b) => b.orders - a.orders).slice(0, 10);
  createChart('localRank', 'localRankChart', {
    type: 'bar',
    data: {
      labels: rank.map((r) => trim(r.localName, 24)),
      datasets: [
        { label: 'Orders', data: rank.map((r) => r.orders), backgroundColor: 'rgba(22,93,255,.78)', borderRadius: 8 },
        { label: 'Ciclo P50', data: rank.map((r) => r.cycleP50 || 0), backgroundColor: 'rgba(214,31,38,.72)', borderRadius: 8 },
      ],
    },
    options: baseChartOptions(),
  });
}

function baseChartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { mode: 'index', intersect: false } },
    interaction: { mode: 'index', intersect: false },
    scales: extra.dualAxis ? {
      y: { beginAtZero: true, grid: { color: 'rgba(15,23,40,.06)' } },
      y1: { beginAtZero: true, position: 'right', grid: { display: false } },
      x: { grid: { display: false } },
    } : {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: 'rgba(15,23,40,.06)' } },
    },
    ...extra,
  };
}

function doughnutOptions(centerText = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      centerText: { text: centerText }
    },
  };
}

function trim(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initMap() {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  const mapNode = $('map');
  mapNode.innerHTML = '';
  state.map = L.map('map', { zoomControl: true }).setView([-12.05, -77.04], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);
  state.mapLayers = {
    stores: L.layerGroup().addTo(state.map),
    noCoverage: L.layerGroup().addTo(state.map),
    demand: L.layerGroup().addTo(state.map),
    priority: L.layerGroup().addTo(state.map),
  };
}

function clearMapLayers() {
  Object.values(state.mapLayers).forEach((layer) => layer && layer.clearLayers());
}

function renderMap(points, rows) {
  if (!state.map) return;
  clearMapLayers();
  const bounds = [];

  points.forEach((p) => {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    bounds.push([p.lat, p.lng]);
    const color = p.deliveryEnabled ? p.sla.color : '#ef4444';
    const marker = L.circleMarker([p.lat, p.lng], {
      radius: Math.max(6, Math.min(18, 6 + Math.sqrt(p.orders || 0) / 4)),
      color,
      weight: p.deliveryEnabled ? 1.5 : 2.5,
      fillColor: color,
      fillOpacity: p.deliveryEnabled ? .58 : .08,
      dashArray: p.deliveryEnabled ? null : '5 5',
    }).bindPopup(`
      <strong>${escapeHtml(p.localName)}</strong><br>
      ${escapeHtml(p.area || '')} · ${escapeHtml(p.zone || '')}<br>
      Orders: <strong>${number(p.orders)}</strong><br>
      GMV: <strong>${money(p.gmv)}</strong><br>
      Ticket: <strong>${money(p.avgTicket)}</strong><br>
      SLA: <strong>${escapeHtml(p.sla.label)}</strong> ${p.cycleP50 ? `· ${minutes(p.cycleP50)}` : ''}
    `);
    (p.deliveryEnabled ? state.mapLayers.stores : state.mapLayers.noCoverage).addLayer(marker);
  });

  const areaScores = buildPriorityAreas(rows).slice(0, 12);
  areaScores.forEach((a) => {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return;
    bounds.push([a.lat, a.lng]);
    const circle = L.circle([a.lat, a.lng], {
      radius: 900 + (a.score * 18),
      color: '#165dff',
      weight: 1,
      fillColor: '#165dff',
      fillOpacity: .08,
    }).bindPopup(`<strong>${escapeHtml(a.area)}</strong><br>Score prioridad: <strong>${number(a.score, 1)}</strong><br>Órdenes: <strong>${number(a.orders)}</strong><br>Proyecto: <strong>${number(a.projectOrders)}</strong>`);
    state.mapLayers.priority.addLayer(circle);
  });

  const demand = buildDemandPoints(rows);
  demand.forEach((d) => {
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;
    bounds.push([d.lat, d.lng]);
    const marker = L.circle([d.lat, d.lng], {
      radius: 500 + d.orders * 10,
      color: 'rgba(22,93,255,.18)',
      fillColor: '#165dff',
      fillOpacity: .08,
      weight: 0,
    }).bindPopup(`<strong>${escapeHtml(d.place)}</strong><br>Orders proxy: <strong>${number(d.orders)}</strong>`);
    state.mapLayers.demand.addLayer(marker);
  });

  updateMapLayerVisibility();
  if (bounds.length) state.map.fitBounds(bounds, { padding: [26, 26] });
  setTimeout(() => state.map.invalidateSize(), 100);
}

function buildPriorityAreas(rows) {
  const groupedArea = grouped(rows, 'area');
  const lookup = new Map((state.raw.areaPriority || []).map((a) => [a.area, a]));
  return groupedArea.map((g) => {
    const hint = lookup.get(g.name) || {};
    const cyclePenalty = Number.isFinite(g.cycleP50) ? Math.max(0, 50 - g.cycleP50) : 10;
    return {
      area: g.name,
      zone: g.zone,
      orders: g.orders,
      projectOrders: g.projectOrders,
      score: (g.projectOrders * 1.4) + (g.orders * 0.25) + (g.locals * 18) + cyclePenalty,
      lat: hint.lat,
      lng: hint.lng,
    };
  }).sort((a,b) => b.score - a.score);
}

function buildDemandPoints(rows) {
  const selectedMacro = state.filters.macroRegions;
  const points = (state.raw.demandPoints || []).filter((d) => !selectedMacro.length || selectedMacro.includes(d.place === 'Lima' ? 'Lima' : 'Provincia'));
  const totalOrders = sum(rows.map((r) => r.ordersAdj));
  const base = sum((state.raw.demandPoints || []).map((d) => d.orders)) || 1;
  return points.map((p) => ({ ...p, orders: (p.orders / base) * totalOrders * 0.45 })).filter((p) => p.orders > 0);
}

function updateMapLayerVisibility() {
  if (!state.mapLayers.stores) return;
  const toggles = {
    stores: $('toggleStores').checked,
    demand: $('toggleDemand').checked,
    priority: $('togglePriority').checked,
    noCoverage: $('toggleNoCoverage').checked,
  };
  Object.entries(toggles).forEach(([key, visible]) => {
    const layer = state.mapLayers[key];
    if (!layer) return;
    if (visible && !state.map.hasLayer(layer)) state.map.addLayer(layer);
    if (!visible && state.map.hasLayer(layer)) state.map.removeLayer(layer);
  });
}

function renderTable(points) {
  const columns = [
    ['localName', 'Local', 'text'],
    ['area', 'Área', 'text'],
    ['zone', 'Zona', 'text'],
    ['coverageType', 'Cobertura', 'text'],
    ['orders', 'Orders', 'number'],
    ['gmv', 'GMV', 'number'],
    ['avgTicket', 'Ticket', 'number'],
    ['avgDistanceKm', 'Distancia', 'number'],
    ['cycleP50', 'Ciclo P50', 'number'],
    ['cycleP90', 'Ciclo P90', 'number'],
    ['drivers', 'Drivers', 'number'],
    ['sla', 'SLA', 'text'],
  ];
  const headRows = `
    <tr>${columns.map(([key, label]) => `<th data-sort="${key}">${label}</th>`).join('')}</tr>
    <tr class="filter-row">${columns.map(([key, label, kind]) => {
      const current = state.tableFilters[key] || '';
      return `<th>${kind === 'number'
        ? `<input data-col-filter="${key}" type="number" step="0.1" placeholder=">= ${label}" value="${escapeHtml(current)}">`
        : `<input data-col-filter="${key}" type="text" placeholder="Filtrar ${label}" value="${escapeHtml(current)}">`}</th>`;
    }).join('')}</tr>`;
  $('localTable').querySelector('thead').innerHTML = headRows;
  const filtered = [...points].filter((p) => columns.every(([key,,kind]) => {
    const needle = (state.tableFilters[key] || '').toString().trim();
    if (!needle) return true;
    if (kind === 'number') return Number(p[key] === undefined ? (key === 'drivers' ? p.drivers : 0) : p[key]) >= Number(needle);
    const value = key === 'sla' ? p.sla.label : p[key];
    return String(value || '').toLowerCase().includes(needle.toLowerCase());
  }));
  const sorted = filtered.sort((a,b) => compareRows(a,b,state.sort.key,state.sort.dir));
  $('localTable').querySelector('tbody').innerHTML = sorted.map((p) => `
    <tr>
      <td>${escapeHtml(p.localName)}</td>
      <td>${escapeHtml(p.area || '—')}</td>
      <td>${escapeHtml(p.zone || '—')}</td>
      <td>${escapeHtml(p.coverageType || '—')}</td>
      <td>${number(p.orders)}</td>
      <td>${money(p.gmv)}</td>
      <td>${money(p.avgTicket)}</td>
      <td>${km(p.avgDistanceKm)}</td>
      <td>${minutes(p.cycleP50)}</td>
      <td>${minutes(p.cycleP90)}</td>
      <td>${number(p.drivers)}</td>
      <td><span class="sla-pill ${p.sla.className}">${escapeHtml(p.sla.label)}</span></td>
    </tr>`).join('');
  $('localTable').querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.key = key; state.sort.dir = ['localName','area','zone','coverageType','sla'].includes(key) ? 'asc' : 'desc'; }
      renderTable(points);
    });
  });
  $('localTable').querySelectorAll('[data-col-filter]').forEach((input) => {
    input.addEventListener('input', (e) => {
      state.tableFilters[e.target.dataset.colFilter] = e.target.value;
      renderTable(points);
    });
  });
}

function buildDayparts(lunchSharePct, dinnerSharePct) {
  const lunch = Math.max(0, Math.min(70, lunchSharePct || 0));
  const dinner = Math.max(0, Math.min(70, dinnerSharePct || 0));
  const remaining = Math.max(0, 100 - lunch - dinner);
  const morning = remaining * 0.45;
  const afternoon = remaining * 0.55;
  return [
    { key: 'morning', label: 'Mañana', share: morning / 100 },
    { key: 'lunch', label: 'Almuerzo', share: lunch / 100 },
    { key: 'afternoon', label: 'Tarde', share: afternoon / 100 },
    { key: 'dinner', label: 'Cena', share: dinner / 100 },
  ];
}

function alertTone(type) {
  return type === 'bad' ? 'bad' : type === 'warn' ? 'warn' : 'good';
}

function compareRows(a,b,key,dir) {
  const av = key === 'sla' ? a.sla.label : a[key];
  const bv = key === 'sla' ? b.sla.label : b[key];
  const factor = dir === 'asc' ? 1 : -1;
  if (typeof av === 'string') return av.localeCompare(String(bv || '')) * factor;
  if (av == null && bv == null) return 0;
  return ((Number(av) || 0) - (Number(bv) || 0)) * factor;
}


function renderSimulator(rows, summary) {
  const users = Number($('simUsers').value) || 0;
  const exposurePct = (Number($('simExposure').value) || 0) / 100;
  const ctrPct = (Number($('simCtr').value) || 0) / 100;
  const conversionPct = (Number($('simConversion').value) || 0) / 100;
  const deliveryMixPct = (Number($('simDeliveryMix').value) || 0) / 100;
  const ordersDriver = Math.max(Number($('simOrdersDriver').value) || 1, 0.1);
  const days = Math.max(Number($('simDays').value) || 30, 1);
  const target = Number($('simTarget').value) || 7500;
  const bufferPct = (Number($('simBuffer').value) || 0) / 100;
  const peakFactor = Math.max(Number($('simPeakFactor').value) || 1, 1);

  const baseTotalMonth = summary.avgOrdersMonth || 0;
  const baseDeliveryMonth = safeDivision(summary.deliveryOrders, Math.max(summary.months || 1, 1));
  const basePickupMonth = safeDivision(summary.pickupOrders, Math.max(summary.months || 1, 1));
  const baseDriversDailyAvg = safeDivision(baseDeliveryMonth, ordersDriver * days);
  const baseDriverDaysMonth = safeDivision(baseDeliveryMonth, ordersDriver);
  const historicalUniqueDriversMonth = summary.activeDrivers || 0;
  const avgActiveDaysPerUniqueDriver = safeDivision(baseDriverDaysMonth, Math.max(historicalUniqueDriversMonth, 1));

  const incrementalOrders = users * exposurePct * ctrPct * conversionPct;
  const incrementalDelivery = incrementalOrders * deliveryMixPct;
  const incrementalPickup = incrementalOrders - incrementalDelivery;
  const incrementalDriversDailyAvg = safeDivision(incrementalDelivery, ordersDriver * days);
  const incrementalDriverDaysMonth = safeDivision(incrementalDelivery, ordersDriver);

  const totalOrdersMonth = baseTotalMonth + incrementalOrders;
  const totalDeliveryMonth = baseDeliveryMonth + incrementalDelivery;
  const totalDriversDailyAvg = baseDriversDailyAvg + incrementalDriversDailyAvg;
  const baseSuggestedDriversDaily = baseDriversDailyAvg * (1 + bufferPct) * peakFactor;
  const recommendedDriversDaily = totalDriversDailyAvg * (1 + bufferPct) * peakFactor;
  const incrementalSuggestedDriversDaily = Math.max(recommendedDriversDaily - baseSuggestedDriversDaily, 0);
  const totalDriverDaysMonth = baseDriverDaysMonth + incrementalDriverDaysMonth;
  const baseSuggestedDriverDaysMonth = baseDriverDaysMonth * (1 + bufferPct) * peakFactor;
  const recommendedDriverDaysMonth = totalDriverDaysMonth * (1 + bufferPct) * peakFactor;
  const incrementalSuggestedDriverDaysMonth = Math.max(recommendedDriverDaysMonth - baseSuggestedDriverDaysMonth, 0);
  const totalDeliveryDaily = safeDivision(totalDeliveryMonth, days);
  const suggestedUniqueDriversMonth = safeDivision(recommendedDriverDaysMonth, Math.max(avgActiveDaysPerUniqueDriver, 1e-9));
  const additionalUniqueDriversMonth = Math.max(safeDivision(incrementalSuggestedDriverDaysMonth, Math.max(avgActiveDaysPerUniqueDriver, 1e-9)), 0);

  const additionalNeededForTarget = Math.max(target - incrementalOrders, 0);
  const targetDeliveryNeeded = target * deliveryMixPct;
  const requiredExposureForTarget = safeDivision(target, Math.max(users * ctrPct * conversionPct, 1));
  const targetDriversDailyAvg = baseDriversDailyAvg + safeDivision(targetDeliveryNeeded, ordersDriver * days);
  const targetRecommendedDriversDaily = targetDriversDailyAvg * (1 + bufferPct) * peakFactor;
  const targetDriverDays = (baseDriverDaysMonth + safeDivision(targetDeliveryNeeded, ordersDriver)) * (1 + bufferPct) * peakFactor;
  const targetAdditionalDriversDaily = Math.max(targetRecommendedDriversDaily - baseSuggestedDriversDaily, 0);

  const prepTarget = 12;
  const waitTarget = 3;
  const cycleTarget = 35;
  const currentPrepIndicator = [summary.actP50, summary.acceptP50].filter(Number.isFinite).reduce((a,b)=>a+b,0);

  const zoneBuckets = grouped(rows.filter((r) => r.typeSelection !== 'pickup'), 'zone')
    .map((z) => {
      const zoneRows = rows.filter((r) => (r.zone || 'Sin dato') === z.name);
      const deliveryMonth = safeDivision(sum(zoneRows.map((r) => Number(r.deliveryOrders) || 0)), Math.max(summary.months || 1, 1));
      const signal = sum(zoneRows.map((r) => Number(r.projectOrdersAdj) || Number(r.projectOrders) || 0));
      const readiness = 1 / Math.max((z.cycleP50 || 35), 20);
      const priorityScore = signal * 0.55 + deliveryMonth * 0.30 + readiness * 100 * 0.15;
      return { ...z, deliveryMonth, signal, priorityScore };
    })
    .sort((a,b) => b.priorityScore - a.priorityScore);
  const priorityBase = sum(zoneBuckets.map((z) => Math.max(z.priorityScore, 0))) || 1;

  const zoneCards = zoneBuckets.slice(0, 6).map((z) => {
    const share = Math.max(z.priorityScore, 0) / priorityBase;
    const incOrders = incrementalOrders * share;
    const incDelivery = incOrders * deliveryMixPct;
    const baseDrivers = safeDivision(z.deliveryMonth, ordersDriver * days) * (1 + bufferPct) * peakFactor;
    const incDrivers = safeDivision(incDelivery, ordersDriver * days) * (1 + bufferPct) * peakFactor;
    const totalDrivers = baseDrivers + incDrivers;
    const gapDrivers = incDrivers;
    const recPrep = totalDrivers > 3 ? Math.min(prepTarget, 10) : prepTarget;
    return { name: z.name, share, incOrders, incDelivery, baseDrivers, incDrivers, totalDrivers, gapDrivers, cycleP50: z.cycleP50, signal: z.signal, recPrep };
  });

  const dayparts = buildDayparts();
  const daypartRows = dayparts.map((dp) => ({
    ...dp,
    baseOrders: safeDivision(baseDeliveryMonth, days) * dp.share,
    incrementalOrders: safeDivision(incrementalDelivery, days) * dp.share,
    totalOrders: totalDeliveryDaily * dp.share,
    requiredDrivers: recommendedDriversDaily * dp.share,
    baseSuggestedDrivers: baseSuggestedDriversDaily * dp.share,
    extraSuggestedDrivers: incrementalSuggestedDriversDaily * dp.share,
    gapDrivers: incrementalSuggestedDriversDaily * dp.share,
  }));
  const peakDaypart = [...daypartRows].sort((a,b) => b.requiredDrivers - a.requiredDrivers)[0];
  const worstGapDaypart = [...daypartRows].sort((a,b) => b.gapDrivers - a.gapDrivers)[0];
  const capacityGap = incrementalSuggestedDriversDaily;
  const capacityGapPct = safeDivision(capacityGap, Math.max(baseSuggestedDriversDaily, 1));

  const zoneAlerts = zoneCards.slice(0, 4).map((z) => {
    const tone = z.cycleP50 > 42 || z.gapDrivers > 1.8 ? 'bad' : z.cycleP50 > 35 || z.gapDrivers > 0.7 ? 'warn' : 'good';
    const title = tone === 'bad' ? 'Refuerzo inmediato' : tone === 'warn' ? 'Monitorear de cerca' : 'Lista para escalar';
    return {
      tone,
      title: `${z.name}: ${title}`,
      detail: `Base sugerida ${number(z.baseDrivers,1)} drivers/día · extra por inDrive ${number(z.incDrivers,1)} · total ${number(z.totalDrivers,1)} · ciclo ${minutes(z.cycleP50)}.`
    };
  });
  const localAlerts = rows
    .filter((r) => r.typeSelection !== 'pickup' && Number.isFinite(r.cycleP50))
    .sort((a,b) => (b.cycleP50 || 0) - (a.cycleP50 || 0))
    .slice(0, 3)
    .map((r) => ({
      tone: r.cycleP50 > 45 ? 'bad' : 'warn',
      title: `${r.localName}: vigilar SLA`,
      detail: `Ciclo P50 ${minutes(r.cycleP50)} · espera tienda ${minutes(r.waitP50)} · delivery observado ${number(r.deliveryOrders || 0)} órdenes.`
    }));
  const globalAlert = {
    tone: capacityGap > 0 ? (capacityGapPct > 0.2 ? 'bad' : 'warn') : 'good',
    title: capacityGap > 0 ? 'Capacidad instalada insuficiente' : 'Capacidad instalada suficiente',
    detail: capacityGap > 0
      ? `Se recomienda sumar ${number(Math.abs(capacityGap),1)} drivers/día adicionales sobre la base histórica para sostener el incremental configurado.`
      : `La base histórica absorbería el escenario actual sin necesidad de refuerzo adicional.`
  };
  const allAlerts = [globalAlert, ...zoneAlerts, ...localAlerts].slice(0, 6);

  $('simulatorOutput').innerHTML = `
    <div class="sim-hero-grid">
      <div class="sim-stat">
        <span>Base actual / mes</span>
        <strong>${number(baseTotalMonth)}</strong>
        <small>${number(baseDeliveryMonth)} delivery + ${number(basePickupMonth)} retiro</small>
      </div>
      <div class="sim-stat">
        <span>Incremental inDrive / mes</span>
        <strong>${number(incrementalOrders)}</strong>
        <small>${number(incrementalDelivery)} delivery + ${number(incrementalPickup)} retiro</small>
      </div>
      <div class="sim-stat emphasis">
        <span>Volumen total a sostener</span>
        <strong>${number(totalOrdersMonth)}</strong>
        <small>base actual + incremento configurado</small>
      </div>
      <div class="sim-stat">
        <span>Drivers sugeridos / día</span>
        <strong>${number(recommendedDriversDaily, 1)}</strong>
        <small>${number(baseSuggestedDriversDaily, 1)} base sugerida + ${number(incrementalSuggestedDriversDaily,1)} extra por inDrive · buffer ${(bufferPct*100).toFixed(0)}% · factor pico ${peakFactor.toFixed(2)}x</small>
      </div>
    </div>
    <p>Con la configuración actual, el proyecto aportaría <strong>${number(incrementalOrders)}</strong> órdenes incrementales al mes. La red debería estar preparada para mover <strong>${number(totalOrdersMonth)}</strong> órdenes mensuales. Primero calculamos un <strong>promedio equivalente</strong> de drivers/día sobre el delivery total, y luego lo convertimos en un <strong>staffing sugerido</strong> aplicando colchón operativo y factor de pico.</p>
    <p>La base histórica hoy equivale a <strong>${number(baseDriversDailyAvg, 1)}</strong> drivers/día promedio y a <strong>${number(historicalUniqueDriversMonth)}</strong> drivers únicos activos por mes. Bajo los supuestos actuales, eso se traduce en una base sugerida de <strong>${number(baseSuggestedDriversDaily, 1)}</strong> drivers/día. Para absorber el incremental de inDrive se recomienda sumar <strong>${number(incrementalSuggestedDriversDaily, 1)}</strong> drivers/día adicionales, llevando el total sugerido a <strong>${number(recommendedDriversDaily, 1)}</strong>.</p>
    <p>El pico más exigente sería <strong>${peakDaypart.label}</strong>, donde sugerimos planificar alrededor de <strong>${number(peakDaypart.requiredDrivers,1)}</strong> drivers/día. Si la meta incremental es <strong>${number(target)}</strong> órdenes por mes, todavía faltan <strong>${number(additionalNeededForTarget)}</strong> por capturar; manteniendo el mismo CTR y conversión, tendrías que exponer Tambo a <strong>${(requiredExposureForTarget * 100).toFixed(1)}%</strong> de la base activa. Ese escenario llevaría el staffing sugerido total a <strong>${number(targetRecommendedDriversDaily, 1)}</strong> drivers/día, es decir <strong>${number(targetAdditionalDriversDaily,1)}</strong> adicionales sobre la base histórica.</p>`;

  const targetNode = $('capacityTargets');
  if (targetNode) {
    targetNode.innerHTML = `
      <div class="executive-card accent-blue">
        <span class="eyebrow-mini">Preparación sugerida</span>
        <strong>≤ ${prepTarget} min</strong>
        <span>Objetivo sugerido desde activación hasta aceptación. Hoy el indicador combinado luce en ${minutes(currentPrepIndicator)}. Con mayor tráfico, conviene acercarse a ${prepTarget} min para no trasladar presión a tienda.</span>
      </div>
      <div class="executive-card accent-lime">
        <span class="eyebrow-mini">Espera driver en tienda</span>
        <strong>≤ ${waitTarget} min P50</strong>
        <span>Hoy la lectura saneada del filtro marca ${minutes(summary.waitP50)} P50. Este es el tramo más sensible para absorber el volumen incremental sin deteriorar el ciclo total.</span>
      </div>
      <div class="executive-card ${capacityGap > 0 ? 'accent-red' : 'accent-lime'}">
        <span class="eyebrow-mini">Capacidad delivery</span>
        <strong>${number(installedDrivers,1)} vs ${number(recommendedDriversDaily,1)}</strong>
        <span>${capacityGap > 0 ? `Se recomienda sumar ${number(capacityGap,1)} drivers/día adicionales sobre la base histórica. El mayor refuerzo se concentraría en ${worstGapDaypart.label}.` : `La base histórica absorbería el escenario actual sin refuerzo adicional.`}</span>
      </div>
      <div class="executive-card accent-dark">
        <span class="eyebrow-mini">Ciclo total objetivo</span>
        <strong>≤ ${cycleTarget} min P50</strong>
        <span>Hoy el ciclo recalculado está en ${minutes(summary.cycleP50)} P50 y ${minutes(summary.cycleP90)} P90. Abrir más tráfico sin acercarse a este umbral aumenta riesgo operativo.</span>
      </div>`;
  }

  const scenarios = [30, 50, 100].map((x) => {
    const incOrders = users * (x / 100) * ctrPct * conversionPct;
    const incDelivery = incOrders * deliveryMixPct;
    const incPickup = incOrders - incDelivery;
    const totalMonth = baseTotalMonth + incOrders;
    const avgDrivers = baseDriversDailyAvg + safeDivision(incDelivery, ordersDriver * days);
    const totalDrivers = avgDrivers * (1 + bufferPct) * peakFactor;
    const totalDriverDays = (baseDriverDaysMonth + safeDivision(incDelivery, ordersDriver)) * (1 + bufferPct) * peakFactor;
    const gap = totalDrivers - installedDrivers;
    return { exposure: x, incremental: incOrders, totalMonth, incDelivery, incPickup, totalDrivers, avgDrivers, totalDriverDays, gap };
  });

  const methodologyNode = $('capacityMethodology');
  if (methodologyNode) {
    methodologyNode.innerHTML = `
      <div class="method-card">
        <strong>Cómo calculamos drivers/día</strong>
        <p><strong>Promedio equivalente</strong> = delivery mensual ÷ días operativos ÷ órdenes efectivas por driver por día.</p>
        <ul>
          <li>Base actual delivery/mes: ${number(baseDeliveryMonth)}</li>
          <li>Incremental delivery/mes: ${number(incrementalDelivery)}</li>
          <li>Productividad asumida: ${number(ordersDriver,1)} órdenes por driver por día</li>
          <li>Drivers únicos activos observados/mes: ${number(historicalUniqueDriversMonth)}</li>
        </ul>
      </div>
      <div class="method-card">
        <strong>Por qué el staffing sugerido es mayor al promedio</strong>
        <p>El promedio simple suele subestimar la operación. Por eso aplicamos un <strong>colchón operativo de ${(bufferPct*100).toFixed(0)}%</strong> para cubrir variabilidad, cancelaciones, tiempos muertos y reposición, y un <strong>factor de pico de ${peakFactor.toFixed(2)}x</strong> para proteger horas de mayor compresión.</p>
      </div>
      <div class="method-card">
        <strong>Qué significa cada métrica</strong>
        <ul>
          <li><strong>Promedio equivalente:</strong> referencia diaria media.</li>
          <li><strong>Drivers sugeridos/día:</strong> staffing recomendado total para operar base + incremental sin deteriorar SLA.</li>
          <li><strong>Drivers extra/día:</strong> refuerzo sugerido sobre la base histórica para capturar el incremental de inDrive.</li>
          <li><strong>Driver-días/mes:</strong> capacidad total mensual a asegurar.</li>
        </ul>
      </div>`;
  }

  $('staffingCards').innerHTML = scenarios.map((s) => `
    <div class="staff-card">
      <span>${s.exposure}% de exposición</span>
      <strong>${number(s.incremental)} órdenes incrementales</strong>
      <small>${number(s.incDelivery)} delivery + ${number(s.incPickup)} retiro · total sistema ${number(s.totalMonth)} órdenes/mes · ${number(s.totalDrivers, 1)} drivers/día sugeridos · ${number(Math.max(s.totalDrivers - baseSuggestedDriversDaily,0),1)} extra sobre la base · ${number(s.totalDriverDays, 0)} driver-días/mes</small>
    </div>`).join('') + zoneCards.map((z) => `
    <div class="staff-card zone-card">
      <span>${escapeHtml(z.name)}</span>
      <strong>${number(z.incOrders)} órdenes incrementales</strong>
      <small>${(z.share * 100).toFixed(1)}% del mix potencial · base ${number(z.baseDrivers, 1)} drivers/día · extra inDrive ${number(z.incDrivers, 1)} · total sugerido ${number(z.totalDrivers,1)}</small>
    </div>`).join('');

  const franjaNode = $('franjaPlan');
  if (franjaNode) {
    franjaNode.innerHTML = daypartRows.map((d) => `
      <div class="franja-card">
        <strong>${escapeHtml(d.label)}</strong>
        <span class="big">${number(d.requiredDrivers,1)} drivers/día sugeridos</span>
        <small>Base ${number(d.baseOrders,0)} órdenes/día · incremental ${number(d.incrementalOrders,0)} · total ${number(d.totalOrders,0)} · base sugerida ${number(d.baseSuggestedDrivers,1)} · extra ${number(d.extraSuggestedDrivers,1)}</small>
      </div>
    `).join('');
  }

  const alertNode = $('capacityAlerts');
  if (alertNode) {
    alertNode.innerHTML = `<div class="capacity-alert-list">${allAlerts.map((a) => `
      <div class="capacity-alert ${alertTone(a.tone)}">
        <strong>${escapeHtml(a.title)}</strong>
        <span>${escapeHtml(a.detail)}</span>
      </div>`).join('')}</div>`;
  }
  const zoneListNode = $('zoneCapacityList');
  if (zoneListNode) {
    zoneListNode.innerHTML = zoneCards.slice(0, 5).map((z) => {
      const tone = z.gapDrivers > 1.8 || z.cycleP50 > 42 ? 'bad' : z.gapDrivers > 0.7 || z.cycleP50 > 35 ? 'warn' : 'good';
      const recommendation = tone === 'bad'
        ? `Abrir gradualmente y sumar ${number(Math.ceil(Math.max(z.gapDrivers,0)),0)} drivers/día antes de escalar.`
        : tone === 'warn'
          ? `Abrir con monitoreo y colchón mínimo de ${number(Math.ceil(Math.max(z.gapDrivers,0.5)),0)} drivers/día.`
          : `Zona lista para escalar con preparación sugerida ≤ ${z.recPrep} min.`;
      return `<div class="capacity-alert ${tone} zone-capacity-mini">
        <strong>${escapeHtml(z.name)}</strong>
        <span>${recommendation} Base ${number(z.baseDrivers,1)} · extra inDrive ${number(z.incDrivers,1)} · total sugerido ${number(z.totalDrivers,1)} drivers/día · ciclo ${minutes(z.cycleP50)}.</span>
      </div>`;
    }).join('');
  }

  createChart('capacity', 'capacityChart', {
    type: 'bar',
    data: {
      labels: ['Base sugerida', 'Extra inDrive', 'Sugerido total', 'Drivers únicos/mes'],
      datasets: [{
        label: 'Drivers activos / día',
        data: [baseSuggestedDriversDaily, incrementalSuggestedDriversDaily, recommendedDriversDaily, historicalUniqueDriversMonth],
        backgroundColor: ['rgba(22,93,255,.72)', 'rgba(152,193,29,.82)', 'rgba(214,31,38,.82)', 'rgba(16,28,54,.78)'],
        borderRadius: 8,
      }]
    },
    options: baseChartOptions(),
  });

  createChart('daypart', 'daypartChart', {
    type: 'bar',
    data: {
      labels: daypartRows.map((d) => d.label),
      datasets: [
        { label: 'Base sugerida', data: daypartRows.map((d) => d.baseSuggestedDrivers), backgroundColor: 'rgba(22,93,255,.72)', borderRadius: 8 },
        { label: 'Extra inDrive', data: daypartRows.map((d) => d.extraSuggestedDrivers), backgroundColor: 'rgba(152,193,29,.82)', borderRadius: 8 },
        { type: 'line', label: 'Total sugerido', data: daypartRows.map((d) => d.requiredDrivers), borderColor: '#d61f26', backgroundColor: '#d61f26', tension: .3, yAxisID: 'y' }
      ]
    },
    options: baseChartOptions(),
  });

  createChart('zoneCapacity', 'zoneCapacityChart', {
    type: 'bar',
    data: {
      labels: zoneCards.map((z) => trim(z.name, 18)),
      datasets: [
        { label: 'Base sugerida', data: zoneCards.map((z) => z.baseDrivers), backgroundColor: 'rgba(22,93,255,.72)', borderRadius: 8, stack: 'drivers' },
        { label: 'Extra inDrive', data: zoneCards.map((z) => z.incDrivers), backgroundColor: 'rgba(152,193,29,.82)', borderRadius: 8, stack: 'drivers' },
        { label: 'Total sugerido', data: zoneCards.map((z) => z.totalDrivers), backgroundColor: 'rgba(16,28,54,.78)', borderRadius: 8 }
      ]
    },
    options: baseChartOptions(),
  });
}
window.addEventListener('DOMContentLoaded', async () => {
  initControls();
  if (state.isAuthenticated) await boot();
});
