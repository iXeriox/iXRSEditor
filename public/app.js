const $ = selector => document.querySelector(selector);
const {
  findInventories, findSkills, findStats, findItemCatalog, findItemIdentity, slotInfo, setAt, levelForXp, xpForLevel, label,
  inventoryAdd, inventoryRemoveAt, inventoryReplaceAt, inventoryDuplicateAt
} = EditorTools;
const uploadView = $('#uploadView');
const editorView = $('#editorView');
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const editor = $('#jsonEditor');
let sourceFile;
let saveFormat;
let saveData;
let dataCatalog = [];
let catalogError = null;

// --- Session state: undo history, unsaved-changes tracking, active tab ---
const HISTORY_LIMIT = 30;
let history = [];
let isDirty = false;
let currentPanel = 'overview';

function debounce(fn, wait) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

const catalogReady = fetch('/api/catalog').then(async response => {
  const catalog = await response.json();
  if (!response.ok) throw new Error(catalog.error || 'Unable to load Items.json');
  dataCatalog = catalog.entries || [];
  if (saveData) renderAll();
}).catch(error => { catalogError = error.message; });

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ''; }, 3600);
}

function updateDirtyIndicator() {
  const dot = $('#dirtyDot');
  if (dot) dot.hidden = !isDirty;
}

function setDirty(value) {
  isDirty = value;
  updateDirtyIndicator();
}

function updateUndoButton() {
  const button = $('#undoBtn');
  if (button) button.disabled = history.length === 0;
}

/** Snapshot the current save before a mutation, so it can be restored with undo(). */
function pushHistory() {
  if (saveData === undefined) return;
  try { history.push(JSON.stringify(saveData)); } catch { return; }
  if (history.length > HISTORY_LIMIT) history.shift();
  updateUndoButton();
}

/** Marks the save as changed: syncs the JSON view and flags unsaved edits. */
function markChanged(message) {
  setDirty(true);
  saveChanged(message);
}

function undo() {
  if (!history.length) return;
  const previous = history.pop();
  updateUndoButton();
  try { saveData = JSON.parse(previous); } catch { toast('Could not undo: history was corrupted.', true); return; }
  saveChanged('Last change undone');
  setDirty(true);
  renderAll();
  toast('Undid last change.');
}

/**
 * Applies any edits made directly in the Full JSON textarea to saveData.
 * Returns false (and shows an error) if the textarea contains invalid JSON.
 */
function applyJsonEditsIfChanged() {
  let parsed;
  try { parsed = JSON.parse(editor.value); }
  catch (error) { toast(`Invalid JSON: ${error.message}`, true); return false; }
  const before = saveData !== undefined ? JSON.stringify(saveData) : null;
  const after = JSON.stringify(parsed);
  if (before !== null && before !== after) {
    history.push(before);
    if (history.length > HISTORY_LIMIT) history.shift();
    updateUndoButton();
    setDirty(true);
  }
  saveData = parsed;
  return true;
}

/** Lightweight promise-based confirmation dialog, styled to match the editor. */
function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'CONFIRM' } = {}) {
  const backdrop = $('#confirmDialog');
  if (!backdrop) return Promise.resolve(true);
  return new Promise(resolve => {
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    const okBtn = $('#confirmOk');
    const cancelBtn = $('#confirmCancel');
    okBtn.textContent = confirmLabel;
    backdrop.hidden = false;
    const finish = result => {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('mousedown', onBackdropClick);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdropClick = event => { if (event.target === backdrop) finish(false); };
    const onKey = event => { if (event.key === 'Escape') finish(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('mousedown', onBackdropClick);
    document.addEventListener('keydown', onKey);
    okBtn.focus();
  });
}

/**
 * A labelled number input flanked by − / + buttons. Keeps its own display in
 * sync (via apply/setValue) so callers never need to rebuild the DOM just to
 * reflect a new value.
 */
function numberStepper(labelText, value, { min, max } = {}, onChange) {
  const row = document.createElement('div');
  row.className = 'stat-value-row';
  const wrapper = document.createElement('label');
  wrapper.className = 'form-field';
  const title = document.createElement('span');
  title.textContent = labelText;
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  if (min != null) numberInput.min = min;
  if (max != null) numberInput.max = max;
  numberInput.value = value;
  wrapper.append(title, numberInput);

  const decrement = document.createElement('button');
  decrement.type = 'button'; decrement.textContent = '−'; decrement.setAttribute('aria-label', `Decrease ${labelText}`);
  const increment = document.createElement('button');
  increment.type = 'button'; increment.textContent = '+'; increment.setAttribute('aria-label', `Increase ${labelText}`);

  function clamp(next) {
    let number = Math.trunc(Number(next));
    if (!Number.isFinite(number)) number = Math.trunc(Number(numberInput.value)) || 0;
    if (min != null) number = Math.max(min, number);
    if (max != null) number = Math.min(max, number);
    return number;
  }
  function apply(next) {
    const clamped = clamp(next);
    numberInput.value = clamped;
    onChange(clamped);
    return clamped;
  }
  numberInput.addEventListener('change', () => apply(numberInput.value));
  decrement.addEventListener('click', () => apply((Number(numberInput.value) || 0) - 1));
  increment.addEventListener('click', () => apply((Number(numberInput.value) || 0) + 1));
  row.append(decrement, wrapper, increment);
  return { row, apply, setValue(next) { numberInput.value = next; }, input: numberInput };
}

function updateLines() {
  const lines = editor.value.split('\n');
  $('#lines').textContent = lines.map((_, index) => index + 1).join('\n');
  const before = editor.value.slice(0, editor.selectionStart).split('\n');
  $('#position').textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}

function field(name, value, onChange, options = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'form-field';
  const title = document.createElement('span');
  title.textContent = name;
  const input = document.createElement('input');
  input.type = options.type || (typeof value === 'number' ? 'number' : 'text');
  if (options.min != null) input.min = options.min;
  if (options.max != null) input.max = options.max;
  input.value = value ?? '';
  input.addEventListener('change', () => onChange(input.type === 'number' ? Number(input.value) : input.value, input));
  wrapper.append(title, input);
  return wrapper;
}

function emptyState(title, detail) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = detail;
  box.append(heading, text);
  return box;
}

function saveChanged(message = 'Changes saved in this session') {
  editor.value = JSON.stringify(saveData, null, 2);
  updateLines();
  $('#status').textContent = message;
}

function itemEntriesFromData() {
  const itemsDataset = dataCatalog.filter(entry => /^items?$/i.test(entry.dataset || '') || /(^|\/)items?\.json$/i.test(entry.source || ''));
  return itemsDataset.length ? itemsDataset : dataCatalog.filter(entry => /(item|resource|weapon|armou?r|consum|tool)/i.test(`${entry.dataset || ''} ${entry.category} ${entry.source}`));
}

const normalizedId = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
function catalogItemFor(id) {
  const wanted = normalizedId(id);
  const items = itemEntriesFromData();
  const catalog = items.length ? items : dataCatalog;
  return catalog.find(entry => normalizedId(entry.id) === wanted || normalizedId(entry.data?.Id) === wanted || normalizedId(entry.data?.itemId) === wanted || normalizedId(entry.data?.itemData) === wanted);
}

function itemFromCatalog(entry, sample) {
  const item = sample && typeof sample === 'object' ? structuredClone(sample) : {};
  const preferred = nestedProperty(item, (key, value) => typeof value === 'string' && (/^item[_-]?data$/i.test(key) || (key.toLowerCase() === 'value' && catalogItemFor(value))));
  const fallback = preferred || nestedProperty(item, (key, value) => ['string', 'number'].includes(typeof value) && /^(item|asset|definition|itemdefinition)?[_-]?id$/i.test(key) && catalogItemFor(value));
  if (fallback) fallback.owner[fallback.key] = entry.id;
  else item.itemId = entry.id;
  const name = nestedProperty(item, key => /^(item|display)?[_-]?name$/i.test(key));
  if (name) name.owner[name.key] = entry.name;
  if (!sample) item.quantity = 1;
  return item;
}

function catalogImage(entry, className = 'item-image') {
  const hasImage = Boolean(entry?.image);
  const visual = document.createElement(hasImage ? 'img' : 'div');
  visual.className = `${className}${hasImage ? '' : ' image-placeholder'}`;
  if (hasImage) {
    visual.src = entry.image;
    visual.alt = entry.name || '';
    visual.loading = 'lazy';
    // Data can reference artwork that isn't in Images/ yet—fall back gracefully instead of a broken image icon.
    visual.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = `${className} image-placeholder`;
      fallback.textContent = '◆';
      visual.replaceWith(fallback);
    }, { once: true });
  } else {
    visual.textContent = '◆';
  }
  return visual;
}

function itemIdentity(item) {
  const items = itemEntriesFromData();
  return findItemIdentity(item, (items.length ? items : dataCatalog).map(entry => entry.id));
}

/**
 * Some gear slots don't embed item data directly—they just point at the
 * index of the real item elsewhere (Dragonwilds does this for certain
 * Loadout entries, e.g. {"PlayerInventoryItemIndex": 56} referring to
 * Inventory slot 56). Resolves that reference so the card can show the
 * actual equipped item instead of an empty slot.
 */
function crossReferencedItem(item, groups) {
  if (!item || typeof item !== 'object') return null;
  const refKey = Object.keys(item).find(key => /inventoryitemindex$/i.test(key.replace(/[_-]/g, '')));
  if (refKey == null || typeof item[refKey] !== 'number') return null;
  const inventoryGroup = groups.find(candidate => /^(inventory|personalinventory)$/i.test(candidate.name.replace(/\s+/g, '')));
  if (!inventoryGroup) return null;
  const position = inventoryGroup.slotNumbers ? inventoryGroup.slotNumbers.indexOf(item[refKey]) : item[refKey];
  return position !== -1 ? inventoryGroup.items[position] : null;
}

function nestedProperty(root, matcher, seen = new WeakSet()) {
  if (!root || typeof root !== 'object' || seen.has(root)) return null;
  seen.add(root);
  for (const key of Object.keys(root)) if (matcher(key, root[key])) return { owner: root, key, value: root[key] };
  for (const value of Object.values(root)) {
    const result = nestedProperty(value, matcher, seen);
    if (result) return result;
  }
  return null;
}

function stackProperty(item) {
  return nestedProperty(item, (key, value) => typeof value === 'number' && /^(quantity|count|amount|stack|stackcount)$/i.test(key.replace(/[_-]/g, '')));
}

function stackCap(entry, item) {
  const cap = nestedProperty(entry?.data, (key, value) => typeof value === 'number' && /^(maxstack|stacklimit|maxquantity|capacity)$/i.test(key.replace(/[_-]/g, '')))
      || nestedProperty(item, (key, value) => typeof value === 'number' && /^(maxstack|stacklimit|maxquantity|capacity)$/i.test(key.replace(/[_-]/g, '')));
  return cap?.value ?? null;
}

function renderOverview() {
  const inventories = findInventories(saveData);
  const skills = findSkills(saveData);
  const stats = findStats(saveData);
  const panel = $('#overviewPanel');
  panel.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'panel-intro';
  intro.innerHTML = '<p class="eyebrow">QUICK VIEW</p><h3>Your save at a glance</h3><p>Use the focused editors below, or open Full JSON for advanced values.</p>';
  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  [['Inventory groups', inventories.length, 'inventory'], ['Detected stats', stats.length, 'stats'], ['Skills', skills.length, 'skills']].forEach(([name, count, target]) => {
    const card = document.createElement('button');
    card.className = 'summary-card';
    card.innerHTML = `<span>${name}</span><strong>${count}</strong><small>OPEN EDITOR →</small>`;
    card.addEventListener('click', () => activatePanel(target));
    grid.append(card);
  });
  panel.append(intro, grid);
}

/**
 * Re-runs `renderInventory`, then restores search text and scroll position
 * so structural edits (add / remove / duplicate / replace) don't reset the
 * user's place the way a plain re-render would.
 */
function withInventoryStatePreserved(rerender) {
  const panel = $('#inventoryPanel');
  const scrollTop = panel.scrollTop;
  const slotSearches = [...panel.querySelectorAll('.inventory-controls input[type="search"]')].map(input => input.value);
  const catalogSearches = [...panel.querySelectorAll('.catalog-browser input[type="search"]')].map(input => input.value);
  rerender();
  panel.querySelectorAll('.inventory-controls input[type="search"]').forEach((input, index) => {
    input.value = slotSearches[index] || '';
    input.dispatchEvent(new Event('input'));
  });
  panel.querySelectorAll('.catalog-browser input[type="search"]').forEach((input, index) => {
    input.value = catalogSearches[index] || '';
    input.dispatchEvent(new Event('input'));
  });
  panel.scrollTop = scrollTop;
}

/** Mutates the inventory, records undo history, and re-renders without losing search/scroll state. */
function performInventoryChange(mutate, message) {
  pushHistory();
  mutate();
  markChanged(message);
  withInventoryStatePreserved(renderInventory);
}

function renderInventory() {
  const panel = $('#inventoryPanel');
  panel.replaceChildren();
  const groups = findInventories(saveData);
  const saveCatalog = findItemCatalog(saveData);
  const externalItems = itemEntriesFromData();
  const catalog = externalItems.length ? externalItems : saveCatalog;
  const header = document.createElement('div');
  header.className = 'panel-intro';
  header.innerHTML = '<p class="eyebrow">ITEM MANAGEMENT</p><h3>Inventory editor</h3><p>Search your item collection, adjust quantities, duplicate items, or remove slots. Complex values remain available in Full JSON.</p>';
  const catalogStatus = document.createElement('small'); catalogStatus.className = `catalog-status${catalogError ? ' error' : ''}`;
  catalogStatus.textContent = catalogError ? `Catalog error: ${catalogError}` : `${catalog.length.toLocaleString()} Items.json records loaded`;
  header.append(catalogStatus);
  panel.append(header);
  if (!groups.length) return panel.append(emptyState('No inventory collection found', 'This save uses unfamiliar field names. You can still edit every value in Full JSON.'));
  groups.forEach(group => {
    const section = document.createElement('section');
    section.className = 'data-section';
    const heading = document.createElement('h4');
    heading.textContent = `${group.name} (${group.items.length})`;
    const controls = document.createElement('div'); controls.className = 'inventory-controls';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = `Search ${group.name.toLowerCase()}…`;
    controls.append(search);
    const cards = document.createElement('div');
    cards.className = 'item-grid';
    const browser = document.createElement('aside'); browser.className = 'catalog-browser';
    const browserTitle = document.createElement('div'); browserTitle.className = 'catalog-title'; browserTitle.innerHTML = '<strong>ITEM CATALOG</strong><small>Drag an item onto a slot, or click to add</small>';
    const catalogSearch = document.createElement('input'); catalogSearch.type = 'search'; catalogSearch.placeholder = 'Find an item by name or ID…';
    const resultCount = document.createElement('small'); resultCount.className = 'catalog-count';
    const catalogGrid = document.createElement('div'); catalogGrid.className = 'catalog-grid';
    let replaceIndex = null;
    const addCatalogItem = selected => {
      const sample = replaceIndex == null ? group.items.find(item => item && typeof item === 'object') : group.items[replaceIndex];
      const newItem = selected?.data ? itemFromCatalog(selected, sample) : selected?.template ? structuredClone(selected.template) : { itemId: '', quantity: 1 };
      const wasReplace = replaceIndex != null;
      const targetIndex = replaceIndex;
      performInventoryChange(() => {
        if (targetIndex == null) inventoryAdd(group, newItem);
        else inventoryReplaceAt(group, targetIndex, newItem);
      }, wasReplace ? 'Inventory item changed' : 'Inventory item added');
    };
    const renderCatalog = () => {
      catalogGrid.replaceChildren();
      const query = catalogSearch.value.trim().toLowerCase();
      const matches = catalog.filter(entry => `${entry.name} ${entry.id}`.toLowerCase().includes(query));
      resultCount.textContent = `${matches.length.toLocaleString()} item${matches.length === 1 ? '' : 's'}${matches.length > 200 ? ' · showing first 200' : ''}`;
      matches.slice(0, 200).forEach(entry => {
        const choice = document.createElement('button'); choice.className = 'catalog-card'; choice.draggable = true;
        choice.append(catalogImage(entry, 'catalog-image'));
        const name = document.createElement('strong'); name.textContent = entry.name;
        const id = document.createElement('small'); id.textContent = entry.id;
        const category = document.createElement('span'); category.className = 'catalog-category'; category.textContent = entry.category || 'Item';
        choice.title = entry.data?.description || entry.name;
        choice.append(name, category, id);
        choice.addEventListener('dragstart', event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-dragonwilds-item', entry.id); });
        choice.addEventListener('click', () => addCatalogItem(entry)); catalogGrid.append(choice);
      });
      if (!catalog.length) catalogGrid.append(emptyState('No item data found', 'Add item JSON and matching images to Data/ to browse the complete catalog.'));
    };
    catalogSearch.addEventListener('input', debounce(renderCatalog, 120)); renderCatalog();
    browser.append(browserTitle, catalogSearch, resultCount, catalogGrid);
    // Slot maps carry their real slot number in group.slotNumbers (the object
    // key itself)—far more reliable than guessing. Only legacy array-shaped
    // inventories fall back to a nested rangeLocation field or a guessed start.
    const inferredStart = /rune/i.test(group.name) ? 32 : /quest/i.test(group.name) ? 56 : /extended/i.test(group.name) ? 80 : /action|hotbar/i.test(group.name) ? 0 : /inventory|backpack/i.test(group.name) && group.items.length <= 24 ? 8 : 0;
    let previousSlotArea = null;
    group.items.forEach((item, index) => {
      const rangeLocation = group.slotNumbers?.[index]
          ?? nestedProperty(item, (key, value) => typeof value === 'number' && key.replace(/[_-]/g, '').toLowerCase() === 'rangelocation')?.value
          ?? inferredStart + index;
      const slot = slotInfo(rangeLocation);
      if (slot.name !== previousSlotArea) {
        const rangeHeading = document.createElement('h5'); rangeHeading.className = 'slot-range-heading';
        rangeHeading.textContent = `${slot.name} · ${slot.start ?? '?'}–${slot.end ?? '?'}`; cards.append(rangeHeading); previousSlotArea = slot.name;
      }
      const card = document.createElement('article');
      card.className = `item-card slot-${slot.name.toLowerCase().replace(/\s+/g, '-')}`;
      const cardHeader = document.createElement('div'); cardHeader.className = 'item-card-header';
      const slotBadge = document.createElement('span'); slotBadge.className = 'slot-badge'; slotBadge.textContent = `${slot.name} ${slot.position}`; slotBadge.title = `rangeLocation ${slot.location}`;
      cardHeader.append(slotBadge);
      const displayName = item && typeof item === 'object' ? (item.name || item.itemName || item.id || item.itemId) : item;
      const itemId = itemIdentity(item) ?? itemIdentity(crossReferencedItem(item, groups));
      const catalogEntry = catalogItemFor(itemId);
      const itemName = catalogEntry?.name || displayName || 'Empty slot';
      const stack = stackProperty(item); const cap = stackCap(catalogEntry, item);
      let stackBadge = null;
      if (stack) { stackBadge = document.createElement('span'); stackBadge.className = 'stack-badge'; stackBadge.textContent = cap ? `${stack.value} / ${cap}` : `× ${stack.value}`; cardHeader.append(stackBadge); }
      card.append(cardHeader, catalogImage(catalogEntry));
      const title = document.createElement('div'); title.className = 'item-title'; title.textContent = itemName; card.append(title);
      if (itemId != null) { const identifier = document.createElement('small'); identifier.className = 'item-id'; identifier.textContent = itemId; identifier.title = itemId; card.append(identifier); }
      card.dataset.search = `${itemName} ${itemId || ''}`.toLowerCase();
      card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('drop-target'); event.dataTransfer.dropEffect = 'copy'; });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', event => {
        event.preventDefault(); card.classList.remove('drop-target');
        const entry = catalogItemFor(event.dataTransfer.getData('application/x-dragonwilds-item'));
        if (entry) performInventoryChange(() => inventoryReplaceAt(group, index, itemFromCatalog(entry, item)), `Slot ${index + 1} changed to ${entry.name}`);
      });
      if (stack) {
        const quantity = document.createElement('div'); quantity.className = 'quantity-control';
        const stepper = numberStepper(cap ? `Quantity (max ${cap})` : 'Quantity', stack.value, { min: 0, max: cap ?? undefined }, next => {
          pushHistory();
          stack.owner[stack.key] = next;
          markChanged();
          if (stackBadge) stackBadge.textContent = cap ? `${next} / ${cap}` : `× ${next}`;
        });
        stepper.row.querySelector('button:first-of-type').setAttribute('aria-label', `Decrease ${itemName}`);
        stepper.row.querySelector('button:last-of-type').setAttribute('aria-label', `Increase ${itemName}`);
        quantity.append(stepper.row); card.append(quantity);
      }
      if (item && typeof item === 'object') {
        const details = document.createElement('details'); details.className = 'item-details';
        const summary = document.createElement('summary'); summary.textContent = 'More details'; details.append(summary);
        Object.entries(item).filter(([key, value]) => ['string', 'number', 'boolean'].includes(typeof value) && !/^(item|asset|definition|itemdefinition)?[_-]?id$/i.test(key) && !/^(quantity|count|amount|stack|stackcount)$/i.test(key.replace(/[_-]/g, '')) && key.toLowerCase() !== 'value').forEach(([key, value]) => {
          if (typeof value === 'boolean') {
            const toggle = document.createElement('label');
            toggle.className = 'toggle-field';
            const input = document.createElement('input');
            input.type = 'checkbox'; input.checked = value;
            input.addEventListener('change', () => { pushHistory(); item[key] = input.checked; markChanged(); });
            toggle.append(input, document.createTextNode(label(key))); details.append(toggle);
          } else details.append(field(label(key), value, next => { pushHistory(); item[key] = next; markChanged(); }));
        });
        if (details.children.length > 1) card.append(details);
      } else card.append(field('Value', item ?? '', next => { pushHistory(); inventoryReplaceAt(group, index, next); markChanged(); }));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'danger-button'; remove.textContent = 'REMOVE SLOT';
      remove.addEventListener('click', () => performInventoryChange(() => inventoryRemoveAt(group, index), 'Inventory item removed'));
      if (item && typeof item === 'object') {
        const change = document.createElement('button'); change.type = 'button'; change.className = 'secondary-button'; change.textContent = 'CHANGE ITEM';
        change.addEventListener('click', () => { replaceIndex = index; catalogSearch.value = ''; renderCatalog(); catalogSearch.focus(); browser.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
        const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.className = 'secondary-button'; duplicate.textContent = 'DUPLICATE';
        duplicate.addEventListener('click', () => performInventoryChange(() => inventoryDuplicateAt(group, index), 'Inventory item duplicated'));
        card.append(change, duplicate);
      }
      card.append(remove); cards.append(card);
    });
    search.addEventListener('input', () => cards.querySelectorAll('.item-card').forEach(card => { card.hidden = !card.dataset.search.includes(search.value.toLowerCase()); }));
    cards.addEventListener('dragover', event => { if (event.target === cards) event.preventDefault(); });
    cards.addEventListener('drop', event => {
      if (event.target !== cards) return; event.preventDefault();
      const entry = catalogItemFor(event.dataTransfer.getData('application/x-dragonwilds-item'));
      if (entry) addCatalogItem(entry);
    });
    const layout = document.createElement('div'); layout.className = 'inventory-layout';
    const inventorySide = document.createElement('div'); inventorySide.className = 'inventory-side'; inventorySide.append(controls, cards);
    layout.append(inventorySide, browser); section.append(heading, layout); panel.append(section);
  });
}

function renderStats() {
  const panel = $('#statsPanel'); panel.replaceChildren();
  const stats = findStats(saveData);
  const header = document.createElement('div'); header.className = 'panel-intro';
  header.innerHTML = '<p class="eyebrow">CHARACTER VALUES</p><h3>Stat editor</h3><p>Detected health, resources, currency, armour and character-level values.</p>';
  panel.append(header);
  if (!stats.length) return panel.append(emptyState('No common stats found', 'Open Full JSON to find values specific to this save version.'));
  const categories = [
    ['Vitals', /health|hp|stamina|mana|energy|special charge/i], ['Survival', /hunger|thirst|weight|carry|sustenance|hydration/i],
    ['Combat', /armou?r/i], ['Currency', /coin|gold/i], ['Character', /level/i]
  ];
  const grouped = new Map(categories.map(([name]) => [name, []]));
  stats.forEach(stat => (grouped.get(categories.find(([, matcher]) => matcher.test(stat.name))?.[0] || 'Character')).push(stat));
  for (const [category, categoryStats] of grouped) {
    if (!categoryStats.length) continue;
    const section = document.createElement('section'); section.className = 'stat-section';
    const heading = document.createElement('h4'); heading.textContent = category; section.append(heading);
    const grid = document.createElement('div'); grid.className = 'field-grid';
    categoryStats.forEach(stat => {
      const card = document.createElement('div'); card.className = 'stat-card';
      const path = document.createElement('small'); path.textContent = stat.path.slice(0, -1).join(' › ') || 'Root';
      if (typeof stat.value === 'boolean') {
        const toggle = document.createElement('label'); toggle.className = 'toggle-field large';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = stat.value;
        input.addEventListener('change', () => { pushHistory(); setAt(saveData, stat.path, input.checked); markChanged(); });
        toggle.append(input, document.createTextNode(stat.name)); card.append(path, toggle);
      } else {
        // Editing a Max* stat can change other cards' refill targets, so that rare case gets a full (but scoped) re-render.
        const isMaxStat = /^max/i.test(stat.name);
        const stepper = numberStepper(stat.name, stat.value, {}, next => {
          pushHistory(); setAt(saveData, stat.path, next); markChanged();
          if (isMaxStat) renderStats();
        });
        card.append(path, stepper.row);
        if (/^(Health|Hp|Stamina|Mana|Energy)$/i.test(stat.name)) {
          const parentPath = stat.path.slice(0, -1).join('.');
          const maximum = stats.find(candidate => candidate.path.slice(0, -1).join('.') === parentPath && candidate.name.replace(/\s/g, '').toLowerCase() === `max${stat.name}`.replace(/\s/g, '').toLowerCase());
          if (maximum) {
            const refill = document.createElement('button'); refill.type = 'button'; refill.className = 'refill-button'; refill.textContent = `REFILL TO ${maximum.value}`;
            refill.addEventListener('click', () => { stepper.apply(maximum.value); toast(`${stat.name} refilled`); });
            card.append(refill);
          }
        }
      }
      grid.append(card);
    });
    section.append(grid); panel.append(section);
  }
}

/**
 * The hardcoded SKILLS table only ships confirmed IDs for 10 of the 12
 * playable skills (Fishing and Agility are still unidentified). Rather than
 * silently drop those two, findSkills surfaces them with name:null; try to
 * resolve a friendly name from the loaded Data/skills.json catalog, and
 * fall back to a short, still-fully-editable label otherwise.
 */
function skillDisplayName(skill) {
  if (skill.name) return skill.name;
  const catalogMatch = dataCatalog.find(entry => /skills?/i.test(entry.dataset || entry.category || '') && normalizedId(entry.id) === normalizedId(skill.id));
  return catalogMatch?.name || `Unknown skill (${skill.id.slice(0, 8)}…)`;
}

function renderSkills() {
  const panel = $('#skillsPanel'); panel.replaceChildren();
  const skills = findSkills(saveData);
  const header = document.createElement('div'); header.className = 'panel-intro';
  header.innerHTML = '<p class="eyebrow">DRAGONWILDS XP</p><h3>Skill editor</h3><p>Only playable skills are shown—travel counters such as walking distance are excluded. Change either level or exact XP.</p>';
  panel.append(header);
  if (!skills.length) return panel.append(emptyState('No skill XP fields found', 'Skill experience was not identified automatically. Search for its field name in Full JSON.'));
  const grid = document.createElement('div'); grid.className = 'skill-grid';
  skills.forEach(skill => {
    const displayName = skillDisplayName(skill);
    const card = document.createElement('article'); card.className = 'skill-card';
    const level = levelForXp(skill.xp);
    const top = document.createElement('div'); top.className = 'skill-top';
    const name = document.createElement('strong'); name.textContent = displayName; name.title = skill.name ? '' : skill.id;
    const badge = document.createElement('span');
    top.append(name, badge);
    const progress = document.createElement('progress');
    const fields = document.createElement('div'); fields.className = 'skill-fields';
    const note = document.createElement('small');

    // Level and XP represent the same underlying value—editing either updates the other and the progress bar in place.
    function refreshDerived(xp) {
      const newLevel = levelForXp(xp);
      badge.textContent = `LEVEL ${newLevel}`;
      progress.max = newLevel === 99 ? 1 : xpForLevel(newLevel + 1) - xpForLevel(newLevel);
      progress.value = newLevel === 99 ? 1 : xp - xpForLevel(newLevel);
      note.textContent = newLevel === 99 ? 'Maximum level reached' : `${Math.max(0, xpForLevel(newLevel + 1) - xp).toLocaleString()} XP to level ${newLevel + 1}`;
      return newLevel;
    }
    const levelStepper = numberStepper('Level (1–99)', level, { min: 1, max: 99 }, newLevel => {
      pushHistory();
      const newXp = xpForLevel(newLevel);
      setAt(saveData, skill.xpPath, newXp);
      markChanged();
      xpStepper.setValue(newXp);
      refreshDerived(newXp);
    });
    const xpStepper = numberStepper('Experience', skill.xp, { min: 0 }, newXp => {
      pushHistory();
      setAt(saveData, skill.xpPath, newXp);
      markChanged();
      levelStepper.setValue(refreshDerived(newXp));
    });
    fields.append(levelStepper.row, xpStepper.row);
    refreshDerived(skill.xp);
    card.append(top, progress, fields, note); grid.append(card);
  }); panel.append(grid);
}

function renderAll() { renderOverview(); renderInventory(); renderStats(); renderSkills(); }

function activatePanel(name) {
  // Only reparse/re-render when actually leaving the raw JSON editor—switching
  // between the other tabs shouldn't touch the DOM of tabs that didn't change.
  if (currentPanel === 'json' && name !== 'json') {
    if (!applyJsonEditsIfChanged()) return;
    renderAll();
  }
  document.querySelectorAll('.tool-panel').forEach(panel => { panel.hidden = panel.id !== `${name}Panel`; });
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === name));
  currentPanel = name;
}

async function openFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return toast('That file exceeds the 100 MB limit.', true);
  if (isDirty) {
    const proceed = await confirmDialog('Loading a new save will discard your unexported edits to the current one.', { title: 'Discard unsaved changes?', confirmLabel: 'DISCARD & CONTINUE' });
    if (!proceed) return;
  }
  toast('Decoding save…');
  dropzone.classList.add('loading');
  try {
    await catalogReady;
    const response = await fetch('/api/decode', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    sourceFile = file; saveFormat = result.format; saveData = result.json;
    history = []; updateUndoButton(); setDirty(false); currentPanel = 'overview';
    editor.value = JSON.stringify(saveData, null, 2);
    $('#filename').textContent = file.name;
    $('#filemeta').textContent = `${(file.size / 1024).toFixed(1)} KB · ${result.format.compression.toUpperCase()} · ${result.format.encoding.toUpperCase()}`;
    uploadView.hidden = true; editorView.hidden = false; updateLines(); renderAll(); activatePanel('overview');
    toast('Save decoded successfully.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    dropzone.classList.remove('loading');
  }
}

fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, eventObject => { eventObject.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, eventObject => { eventObject.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', event => openFile(event.dataTransfer.files[0]));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activatePanel(tab.dataset.panel)));
$('#changeFile').addEventListener('click', async () => {
  if (isDirty) {
    const proceed = await confirmDialog('You have unexported edits. Switching files will discard them.', { title: 'Discard unsaved changes?', confirmLabel: 'DISCARD & CONTINUE' });
    if (!proceed) return;
  }
  editorView.hidden = true; uploadView.hidden = false; fileInput.value = '';
  sourceFile = null; saveFormat = null; saveData = undefined;
  history = []; updateUndoButton(); setDirty(false);
});
$('#undoBtn')?.addEventListener('click', undo);
$('#formatBtn').addEventListener('click', () => { if (applyJsonEditsIfChanged()) markChanged('JSON formatted'); });
editor.addEventListener('input', updateLines); editor.addEventListener('click', updateLines); editor.addEventListener('keyup', updateLines);
editor.addEventListener('scroll', () => { $('#lines').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); updateLines(); } });
document.addEventListener('keydown', event => {
  const wantsUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
  if (wantsUndo && document.activeElement !== editor && !editorView.hidden) { event.preventDefault(); undo(); }
});
window.addEventListener('beforeunload', event => {
  if (!isDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
$('#downloadBtn').addEventListener('click', async () => {
  if (!applyJsonEditsIfChanged()) return;
  const downloadBtn = $('#downloadBtn');
  const originalLabel = downloadBtn.textContent;
  downloadBtn.disabled = true; downloadBtn.textContent = 'EXPORTING…';
  $('#status').textContent = 'Encoding…';
  try {
    const response = await fetch('/api/encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: saveData, format: saveFormat }) });
    if (!response.ok) throw new Error((await response.json()).error || 'The server could not encode this save.');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${sourceFile.name}.edited`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $('#status').textContent = 'Export complete';
    setDirty(false);
    toast('Edited WGS save exported. Keep your original backup!');
  } catch (error) {
    $('#status').textContent = 'Export failed';
    toast(`Export failed: ${error.message}`, true);
  } finally {
    downloadBtn.disabled = false; downloadBtn.textContent = originalLabel;
  }
});