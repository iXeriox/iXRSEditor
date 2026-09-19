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
  const catalog = findItemCatalog(saveData);
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
    const picker = document.createElement('select'); picker.setAttribute('aria-label', 'Item to add');
    if (!catalog.length) picker.append(new Option('New blank item', ''));
    catalog.forEach((item, catalogIndex) => picker.append(new Option(`${item.name} · ${item.id}`, catalogIndex)));
    const add = document.createElement('button'); add.className = 'ghost'; add.textContent = '+ ADD ITEM';
    controls.append(search, picker, add);
    const cards = document.createElement('div');
    cards.className = 'item-grid';
    add.addEventListener('click', () => {
      const template = catalog[Number(picker.value)]?.template || group.items.find(item => item && typeof item === 'object');
      group.items.push(template ? structuredClone(template) : { itemId: '', quantity: 1 });
      saveChanged('Inventory item added'); renderAll();
    });
    group.items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'item-card';
      const title = document.createElement('div');
      title.className = 'item-title';
      const displayName = item && typeof item === 'object' ? (item.name || item.itemName || item.id || item.itemId) : item;
      title.textContent = `${index + 1}. ${displayName ?? 'Empty slot'}`;
      card.dataset.search = String(displayName ?? '').toLowerCase();
      card.append(title);
      if (item && typeof item === 'object') {
        Object.entries(item).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).forEach(([key, value]) => {
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
        const duplicate = document.createElement('button'); duplicate.className = 'secondary-button'; duplicate.textContent = 'DUPLICATE';
        duplicate.addEventListener('click', () => { group.items.splice(index + 1, 0, structuredClone(item)); saveChanged('Inventory item duplicated'); renderAll(); });
        card.append(duplicate);
      }
      card.append(remove); cards.append(card);
    });
    search.addEventListener('input', () => cards.querySelectorAll('.item-card').forEach(card => { card.hidden = !card.dataset.search.includes(search.value.toLowerCase()); }));
    section.append(heading, controls, cards); panel.append(section);
  });
}

function renderStats() {
  const panel = $('#statsPanel'); panel.replaceChildren();
  const stats = findStats(saveData);
  const header = document.createElement('div'); header.className = 'panel-intro';
  header.innerHTML = '<p class="eyebrow">CHARACTER VALUES</p><h3>Stat editor</h3><p>Detected health, resources, currency, armour and character-level values.</p>';
  panel.append(header);
  if (!stats.length) return panel.append(emptyState('No common stats found', 'Open Full JSON to find values specific to this save version.'));
  const grid = document.createElement('div'); grid.className = 'field-grid';
  stats.forEach(stat => {
    const card = document.createElement('div'); card.className = 'stat-card';
    const path = document.createElement('small'); path.textContent = stat.path.slice(0, -1).join(' › ') || 'Root';
    if (typeof stat.value === 'boolean') {
      const toggle = document.createElement('label'); toggle.className = 'toggle-field large';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = stat.value;
      input.addEventListener('change', () => { setAt(saveData, stat.path, input.checked); saveChanged(); });
      toggle.append(input, document.createTextNode(stat.name)); card.append(path, toggle);
    } else card.append(path, field(stat.name, stat.value, next => { setAt(saveData, stat.path, next); saveChanged(); }));
    grid.append(card);
  }); panel.append(grid);
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
