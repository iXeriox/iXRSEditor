const $ = selector => document.querySelector(selector);
const { findInventories, findSkills, findStats, findItemCatalog, setAt, levelForXp, xpForLevel, label } = EditorTools;
const uploadView = $('#uploadView');
const editorView = $('#editorView');
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const editor = $('#jsonEditor');
let sourceFile;
let saveFormat;
let saveData;
let dataCatalog = [];

fetch('/api/catalog').then(response => response.json()).then(catalog => {
  dataCatalog = catalog.entries || [];
  if (saveData) renderAll();
}).catch(() => { /* The optional Data folder is not installed. */ });

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ''; }, 3600);
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
  return dataCatalog.filter(entry => /(item|resource|weapon|armou?r|consum|tool)/i.test(`${entry.category} ${entry.source}`));
}

const normalizedId = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
function catalogItemFor(id) {
  const wanted = normalizedId(id);
  return dataCatalog.find(entry => normalizedId(entry.id) === wanted || normalizedId(entry.data?.Id) === wanted || normalizedId(entry.data?.itemId) === wanted);
}

function itemFromCatalog(entry, sample) {
  const item = sample && typeof sample === 'object' ? structuredClone(sample) : {};
  let identityUpdated = false;
  const updateIdentity = value => {
    if (!value || typeof value !== 'object' || identityUpdated) return;
    const idKey = Object.keys(value).find(key => /^(item|asset|definition|itemdefinition)?[_-]?id$/i.test(key));
    if (idKey) {
      value[idKey] = entry.id; identityUpdated = true;
      const nameKey = Object.keys(value).find(key => /^(item|display)?[_-]?name$/i.test(key));
      if (nameKey) value[nameKey] = entry.name;
      return;
    }
    Object.values(value).forEach(updateIdentity);
  };
  updateIdentity(item);
  if (!identityUpdated) item.itemId = entry.id;
  if (!sample) item.quantity = 1;
  return item;
}

function catalogImage(entry, className = 'item-image') {
  const visual = document.createElement(entry?.image ? 'img' : 'div');
  visual.className = `${className}${entry?.image ? '' : ' image-placeholder'}`;
  if (entry?.image) { visual.src = entry.image; visual.alt = ''; visual.loading = 'lazy'; }
  else visual.textContent = '◆';
  return visual;
}

function itemIdentity(item) {
  if (!item || typeof item !== 'object') return null;
  const key = Object.keys(item).find(fieldName => /^(item|asset|definition|itemdefinition)?[_-]?id$/i.test(fieldName));
  if (key && ['string', 'number'].includes(typeof item[key])) return item[key];
  for (const child of Object.values(item)) {
    const nested = itemIdentity(child);
    if (nested != null) return nested;
  }
  return null;
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
      if (replaceIndex == null) group.items.push(newItem);
      else group.items[replaceIndex] = newItem;
      saveChanged(replaceIndex == null ? 'Inventory item added' : 'Inventory item changed'); renderAll();
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
        choice.append(name, id);
        choice.addEventListener('dragstart', event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-dragonwilds-item', entry.id); });
        choice.addEventListener('click', () => addCatalogItem(entry)); catalogGrid.append(choice);
      });
      if (!catalog.length) catalogGrid.append(emptyState('No item data found', 'Add item JSON and matching images to Data/ to browse the complete catalog.'));
    };
    catalogSearch.addEventListener('input', renderCatalog); renderCatalog();
    browser.append(browserTitle, catalogSearch, resultCount, catalogGrid);
    group.items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'item-card';
      const cardHeader = document.createElement('div'); cardHeader.className = 'item-card-header';
      const slotBadge = document.createElement('span'); slotBadge.className = 'slot-badge'; slotBadge.textContent = `SLOT ${index + 1}`;
      cardHeader.append(slotBadge);
      const displayName = item && typeof item === 'object' ? (item.name || item.itemName || item.id || item.itemId) : item;
      const itemId = itemIdentity(item);
      const catalogEntry = catalogItemFor(itemId);
      const itemName = catalogEntry?.name || displayName || 'Empty slot';
      const stack = stackProperty(item); const cap = stackCap(catalogEntry, item);
      if (stack) { const badge = document.createElement('span'); badge.className = 'stack-badge'; badge.textContent = cap ? `${stack.value} / ${cap}` : `× ${stack.value}`; cardHeader.append(badge); }
      card.append(cardHeader, catalogImage(catalogEntry));
      const title = document.createElement('div'); title.className = 'item-title'; title.textContent = itemName; card.append(title);
      if (itemId != null) { const identifier = document.createElement('small'); identifier.className = 'item-id'; identifier.textContent = itemId; identifier.title = itemId; card.append(identifier); }
      card.dataset.search = `${itemName} ${itemId || ''}`.toLowerCase();
      card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('drop-target'); event.dataTransfer.dropEffect = 'copy'; });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', event => {
        event.preventDefault(); card.classList.remove('drop-target');
        const entry = catalogItemFor(event.dataTransfer.getData('application/x-dragonwilds-item'));
        if (entry) { group.items[index] = itemFromCatalog(entry, item); saveChanged(`Slot ${index + 1} changed to ${entry.name}`); renderAll(); }
      });
      if (stack) {
        const quantity = document.createElement('div'); quantity.className = 'quantity-control';
        const minus = document.createElement('button'); minus.textContent = '−'; minus.setAttribute('aria-label', `Decrease ${itemName}`);
        const inputField = field(cap ? `Quantity (max ${cap})` : 'Quantity', stack.value, next => { stack.owner[stack.key] = Math.max(0, Math.min(cap ?? Number.MAX_SAFE_INTEGER, Math.trunc(next))); saveChanged(); renderAll(); }, { min: 0, max: cap });
        const plus = document.createElement('button'); plus.textContent = '+'; plus.setAttribute('aria-label', `Increase ${itemName}`);
        minus.addEventListener('click', () => { stack.owner[stack.key] = Math.max(0, stack.owner[stack.key] - 1); saveChanged(); renderAll(); });
        plus.addEventListener('click', () => { stack.owner[stack.key] = Math.min(cap ?? Number.MAX_SAFE_INTEGER, stack.owner[stack.key] + 1); saveChanged(); renderAll(); });
        quantity.append(minus, inputField, plus); card.append(quantity);
      }
      if (item && typeof item === 'object') {
        Object.entries(item).filter(([key, value]) => ['string', 'number', 'boolean'].includes(typeof value) && !/^(item|asset|definition|itemdefinition)?[_-]?id$/i.test(key) && !/^(quantity|count|amount|stack|stackcount)$/i.test(key.replace(/[_-]/g, ''))).forEach(([key, value]) => {
          if (typeof value === 'boolean') {
            const toggle = document.createElement('label');
            toggle.className = 'toggle-field';
            const input = document.createElement('input');
            input.type = 'checkbox'; input.checked = value;
            input.addEventListener('change', () => { item[key] = input.checked; saveChanged(); });
            toggle.append(input, document.createTextNode(label(key))); card.append(toggle);
          } else card.append(field(label(key), value, next => { item[key] = next; saveChanged(); }));
        });
      } else card.append(field('Value', item ?? '', next => { group.items[index] = next; saveChanged(); }));
      const remove = document.createElement('button');
      remove.className = 'danger-button'; remove.textContent = 'REMOVE SLOT';
      remove.addEventListener('click', () => { group.items.splice(index, 1); saveChanged('Inventory item removed'); renderAll(); });
      if (item && typeof item === 'object') {
        const change = document.createElement('button'); change.className = 'secondary-button'; change.textContent = 'CHANGE ITEM';
        change.addEventListener('click', () => { replaceIndex = index; catalogSearch.value = ''; renderCatalog(); catalogSearch.focus(); browser.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
        const duplicate = document.createElement('button'); duplicate.className = 'secondary-button'; duplicate.textContent = 'DUPLICATE';
        duplicate.addEventListener('click', () => { group.items.splice(index + 1, 0, structuredClone(item)); saveChanged('Inventory item duplicated'); renderAll(); });
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
    ['Vitals', /health|hp|stamina|mana|energy/i], ['Survival', /hunger|thirst|weight|carry/i],
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
        input.addEventListener('change', () => { setAt(saveData, stat.path, input.checked); saveChanged(); });
        toggle.append(input, document.createTextNode(stat.name)); card.append(path, toggle);
      } else {
        const row = document.createElement('div'); row.className = 'stat-value-row';
        const decrement = document.createElement('button'); decrement.textContent = '−';
        const valueField = field(stat.name, stat.value, next => { setAt(saveData, stat.path, next); saveChanged(); });
        const increment = document.createElement('button'); increment.textContent = '+';
        decrement.addEventListener('click', () => { setAt(saveData, stat.path, stat.value - 1); saveChanged(); renderStats(); });
        increment.addEventListener('click', () => { setAt(saveData, stat.path, stat.value + 1); saveChanged(); renderStats(); });
        row.append(decrement, valueField, increment); card.append(path, row);
        if (/^(Health|Hp|Stamina|Mana|Energy)$/i.test(stat.name)) {
          const parentPath = stat.path.slice(0, -1).join('.');
          const maximum = stats.find(candidate => candidate.path.slice(0, -1).join('.') === parentPath && candidate.name.replace(/\s/g, '').toLowerCase() === `max${stat.name}`.replace(/\s/g, '').toLowerCase());
          if (maximum) {
            const refill = document.createElement('button'); refill.className = 'refill-button'; refill.textContent = `REFILL TO ${maximum.value}`;
            refill.addEventListener('click', () => { setAt(saveData, stat.path, maximum.value); saveChanged(`${stat.name} refilled`); renderStats(); }); card.append(refill);
          }
        }
      }
      grid.append(card);
    });
    section.append(grid); panel.append(section);
  }
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
    const card = document.createElement('article'); card.className = 'skill-card';
    const level = levelForXp(skill.xp);
    const top = document.createElement('div'); top.className = 'skill-top';
    const name = document.createElement('strong'); name.textContent = skill.name;
    const badge = document.createElement('span'); badge.textContent = `LEVEL ${level}`;
    top.append(name, badge);
    const progress = document.createElement('progress'); progress.max = level === 99 ? 1 : xpForLevel(level + 1) - xpForLevel(level); progress.value = level === 99 ? 1 : skill.xp - xpForLevel(level);
    const fields = document.createElement('div'); fields.className = 'skill-fields';
    fields.append(
      field('Level (1–99)', level, next => { const newLevel = Math.max(1, Math.min(99, Math.trunc(next))); setAt(saveData, skill.xpPath, xpForLevel(newLevel)); saveChanged(); renderAll(); }, { min: 1, max: 99 }),
      field('Experience', skill.xp, next => { setAt(saveData, skill.xpPath, Math.max(0, Math.trunc(next))); saveChanged(); renderAll(); }, { min: 0 })
    );
    const note = document.createElement('small'); note.textContent = level === 99 ? 'Maximum level reached' : `${Math.max(0, xpForLevel(level + 1) - skill.xp).toLocaleString()} XP to level ${level + 1}`;
    card.append(top, progress, fields, note); grid.append(card);
  }); panel.append(grid);
}

function renderAll() { renderOverview(); renderInventory(); renderStats(); renderSkills(); }

function activatePanel(name) {
  if (name !== 'json') {
    try { saveData = JSON.parse(editor.value); } catch { toast('Fix invalid JSON before leaving the advanced editor.', true); return; }
    renderAll();
  }
  document.querySelectorAll('.tool-panel').forEach(panel => { panel.hidden = panel.id !== `${name}Panel`; });
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === name));
}

async function openFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return toast('That file exceeds the 100 MB limit.', true);
  toast('Decoding save…');
  try {
    const response = await fetch('/api/decode', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    sourceFile = file; saveFormat = result.format; saveData = result.json;
    editor.value = JSON.stringify(saveData, null, 2);
    $('#filename').textContent = file.name;
    $('#filemeta').textContent = `${(file.size / 1024).toFixed(1)} KB · ${result.format.compression.toUpperCase()} · ${result.format.encoding.toUpperCase()}`;
    uploadView.hidden = true; editorView.hidden = false; updateLines(); renderAll(); activatePanel('overview');
    toast('Save decoded successfully.');
  } catch (error) { toast(error.message, true); }
}

fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, eventObject => { eventObject.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, eventObject => { eventObject.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', event => openFile(event.dataTransfer.files[0]));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activatePanel(tab.dataset.panel)));
$('#changeFile').addEventListener('click', () => { editorView.hidden = true; uploadView.hidden = false; fileInput.value = ''; });
$('#formatBtn').addEventListener('click', () => { try { saveData = JSON.parse(editor.value); saveChanged('JSON formatted'); } catch (error) { toast(`Invalid JSON: ${error.message}`, true); } });
editor.addEventListener('input', updateLines); editor.addEventListener('click', updateLines); editor.addEventListener('keyup', updateLines);
editor.addEventListener('scroll', () => { $('#lines').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); updateLines(); } });
$('#downloadBtn').addEventListener('click', async () => {
  try {
    saveData = JSON.parse(editor.value); $('#status').textContent = 'Encoding…';
    const response = await fetch('/api/encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: saveData, format: saveFormat }) });
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob(); const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${sourceFile.name}.edited`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000); $('#status').textContent = 'Export complete'; toast('Edited WGS save exported. Keep your original backup!');
  } catch (error) { $('#status').textContent = 'Export failed'; toast(`Invalid JSON: ${error.message}`, true); }
});
