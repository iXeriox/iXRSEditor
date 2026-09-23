(function expose(root, factory) {
  const tools = factory();
  if (typeof module === 'object' && module.exports) module.exports = tools;
  else root.EditorTools = tools;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const isObject = value => value && typeof value === 'object';
  const SKILLS = [
    { name: 'Attack', id: '4pefO9k1lUqfA6mvHNi1SA', aliases: ['attack'] },
    { name: 'Magic', id: '0hreSMRVXUihq9qjDO2CFA', aliases: ['magic'] },
    { name: 'Ranged', id: 'heq7u88Q2UuLXFqLGTVwQw', aliases: ['range', 'ranged'] },
    { name: 'Mining', id: 'jqX0Gh6QI0GFFPCDFK_CJQ', aliases: ['mining'] },
    { name: 'Woodcutting', id: '4zYUGF5u_0KbMLkWJmmBbQ', aliases: ['woodcutting'] },
    { name: 'Artisan', id: 'Wf3i7Ha-B06DH719j1vtBw', aliases: ['artisan'] },
    { name: 'Construction', id: 'waK-8EyQFQ2xEjCGYmuTRQ', aliases: ['construction'] },
    { name: 'Cooking', id: 'Tn7t6DQyX0-Q0cM5K7B90A', aliases: ['cooking'] },
    { name: 'Runecrafting', id: 'NOqC-z-2ckqi0El22qMFlw', aliases: ['runecrafting', 'runecraft'] },
    { name: 'Farming', id: 'PyUi-0LU_riFY46AnnFiWg', aliases: ['farming'] },
    { name: 'Fishing', id: null, aliases: ['fishing'] },
    { name: 'Agility', id: null, aliases: ['agility'] }
  ];
  const SLOT_RANGES = [
    { start: 0, end: 7, name: 'Action Bar' },
    { start: 8, end: 31, name: 'Main Inventory' },
    { start: 32, end: 55, name: 'Rune Inventory' },
    { start: 56, end: 79, name: 'Quest Inventory' },
    { start: 80, end: 103, name: 'Extended Slots' }
  ];

  function slotInfo(location) {
    const numeric = Number(location);
    const range = SLOT_RANGES.find(candidate => numeric >= candidate.start && numeric <= candidate.end);
    if (!range) return { location: numeric, name: 'Unknown Slots', position: Number.isFinite(numeric) ? numeric + 1 : '?' };
    return { location: numeric, name: range.name, position: numeric - range.start + 1, start: range.start, end: range.end };
  }

  function findItemIdentity(root, knownIds = []) {
    const known = new Set([...knownIds].map(value => String(value).toLowerCase()));
    let best = null;
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if (!['string', 'number'].includes(typeof child) || !known.has(String(child).toLowerCase())) continue;
        const normalized = key.replace(/[_-]/g, '').toLowerCase();
        const context = [...path, key, value.Name, value.name].filter(Boolean).join('.').toLowerCase();
        let score = 10;
        if (normalized === 'itemdata') score += 100;
        if (normalized === 'value') score += 70;
        if (/assetpathname|objectpath|reference/.test(normalized)) score += 60;
        if (/^(item|asset|definition|itemdefinition)?id$/.test(normalized)) score += 45;
        if (/itemdata|inventoryitem|itemdefinition/.test(context)) score += 50;
        if (/modifier|multiplier|effect|stat/.test(context)) score -= 80;
        if (!best || score > best.score) best = { value: child, score };
      }
    });
    return best?.value ?? null;
  }

  function walk(value, visitor, path = [], seen = new WeakSet()) {
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    visitor(value, path);
    for (const [key, child] of Object.entries(value)) walk(child, visitor, [...path, key], seen);
  }

  function getAt(root, path) { return path.reduce((value, key) => value?.[key], root); }
  function setAt(root, path, value) {
    const key = path.at(-1);
    const parent = getAt(root, path.slice(0, -1));
    if (parent != null) parent[key] = value;
  }
  const label = key => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

  // Curve calibrated against the in-game thresholds supplied by players:
  // level 63 starts at 103,735 XP and level 80 starts at 223,122 XP.
  const XP_CURVE_EXPONENT = Math.log(223122 / 103735) / Math.log(79 / 62);
  const XP_CURVE_SCALE = 103735 / (62 ** XP_CURVE_EXPONENT);
  function xpForLevel(level) {
    const target = Math.max(1, Math.min(99, Math.trunc(Number(level) || 1)));
    if (target === 1) return 0;
    return Math.round(XP_CURVE_SCALE * ((target - 1) ** XP_CURVE_EXPONENT));
  }

  function levelForXp(xp) {
    const amount = Math.max(0, Number(xp) || 0);
    for (let level = 99; level > 1; level -= 1) if (amount >= xpForLevel(level)) return level;
    return 1;
  }

  // Matches array/object keys that hold player-facing item slots. "loadout"
  // and "equip(ment)" cover gear slots; the rest cover general storage.
  const INVENTORY_KEY_PATTERN = /(inventory|backpack|storage|bank|items|slots|loadout|equip(ment)?|hotbar)/i;

  /**
   * True for a plain object that represents a *slot map*: item records keyed
   * by their numeric slot index (e.g. {"0": {...}, "1": {...}, "MaxSlotIndex": 90})
   * instead of a JS array. Dragonwilds stores its live Inventory, Loadout and
   * PersonalInventory this way, so treating only Array.isArray(child) as
   * "an inventory" misses every real one.
   */
  function isSlotMapContainer(value) {
    if (!isObject(value) || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length) return false;
    const numericKeys = keys.filter(key => /^\d+$/.test(key));
    const otherKeys = keys.filter(key => !/^\d+$/.test(key));
    if (numericKeys.length) return otherKeys.every(key => key === 'MaxSlotIndex');
    return keys.length === 1 && keys[0] === 'MaxSlotIndex'; // an empty slot map
  }

  function slotMapIndices(value) {
    return Object.keys(value).filter(key => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
  }

  function findInventories(root) {
    const results = [];
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if (!INVENTORY_KEY_PATTERN.test(key)) continue;
        if (Array.isArray(child)) {
          // A plain array of IDs/strings (e.g. an "items picked up" log) isn't
          // an editable inventory of item records—skip it so it doesn't
          // shadow the real, object-keyed inventory elsewhere in the save.
          if (child.length && !child.every(isObject)) continue;
          results.push({ name: label(key), path: [...path, key], kind: 'array', items: child, slotNumbers: child.map((_, index) => index) });
        } else if (isSlotMapContainer(child)) {
          const slotNumbers = slotMapIndices(child);
          results.push({
            name: label(key), path: [...path, key], kind: 'slotmap', raw: child,
            items: slotNumbers.map(slot => child[String(slot)]), slotNumbers
          });
        }
      }
    });
    return results.filter((entry, index) => results.findIndex(other => other.path.join('.') === entry.path.join('.')) === index);
  }

  /** Finds the lowest unused numeric slot in a slot-map container. */
  function inventoryFreeSlot(raw) {
    const used = new Set(slotMapIndices(raw));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  function inventoryBumpMax(raw, slot) {
    if (typeof raw.MaxSlotIndex === 'number' && slot > raw.MaxSlotIndex) raw.MaxSlotIndex = slot;
  }

  /** Overwrites the item at a group's logical index, writing through to the real slot key for slot maps. */
  function inventoryReplaceAt(group, index, value) {
    if (group.kind === 'slotmap') group.raw[String(group.slotNumbers[index])] = value;
    group.items[index] = value;
  }

  /** Removes the item at a group's logical index, deleting the underlying slot key for slot maps. */
  function inventoryRemoveAt(group, index) {
    if (group.kind === 'slotmap') {
      delete group.raw[String(group.slotNumbers[index])];
      group.slotNumbers.splice(index, 1);
    }
    group.items.splice(index, 1);
  }

  /** Inserts a new item, picking the next free slot for slot maps. Returns the new logical index. */
  function inventoryInsertAt(group, index, value) {
    if (group.kind === 'slotmap') {
      const slot = inventoryFreeSlot(group.raw);
      group.raw[String(slot)] = value;
      inventoryBumpMax(group.raw, slot);
      const insertAt = group.slotNumbers.findIndex(existing => existing > slot);
      const at = insertAt === -1 ? group.slotNumbers.length : insertAt;
      group.slotNumbers.splice(at, 0, slot);
      group.items.splice(at, 0, value);
      return at;
    }
    group.items.splice(index, 0, value);
    return index;
  }

  /** Appends a new item to the end of a group (or the next free slot for slot maps). */
  function inventoryAdd(group, value) {
    return group.kind === 'slotmap' ? inventoryInsertAt(group, group.items.length, value) : (group.items.push(value), group.items.length - 1);
  }

  /** Duplicates the item at a logical index. Returns the new logical index. */
  function inventoryDuplicateAt(group, index) {
    return inventoryInsertAt(group, index + 1, structuredClone(group.items[index]));
  }

  function findSkills(root) {
    const results = [];
    const identify = value => {
      const normalized = String(value).replace(/(xp|experience)$/i, '').replace(/[^a-z]/gi, '').toLowerCase();
      return SKILLS.find(skill => skill.id === value || skill.aliases.includes(normalized));
    };
    walk(root, (value, path) => {
      const objectId = value.Id ?? value.id ?? value.SkillId ?? value.skillId;
      const identifiedObject = identify(objectId) || identify(value.Name ?? value.name ?? '');
      // path.at(-2) is the key of the array/object this record lives directly
      // inside—e.g. GameProgress.Skills.Skills[i] has path [...,'Skills', i],
      // so at(-2) is 'Skills'. Used below to surface skill IDs the hardcoded
      // SKILLS table doesn't recognise (this save's data has two: the table
      // only ships confirmed IDs for 10 of the 12 playable skills).
      const inSkillsContainer = /^skills?$/i.test(path.at(-2) || '');
      if (identifiedObject || (inSkillsContainer && typeof objectId === 'string' && objectId)) {
        const xpKey = Object.keys(value).find(field => /^(xp|experience|value|amount)$/i.test(field) && typeof value[field] === 'number');
        if (xpKey) {
          results.push(identifiedObject
            ? { name: identifiedObject.name, id: identifiedObject.id, xpPath: [...path, xpKey], xp: value[xpKey] }
            : { name: null, id: objectId, xpPath: [...path, xpKey], xp: value[xpKey] });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        const strippedKey = key.replace(/(xp|experience)$/i, '');
        const flatSkill = identify(strippedKey);
        const nestedSkill = identify(key);
        if (typeof child === 'number' && /(xp|experience)$/i.test(key) && flatSkill) {
          results.push({ name: flatSkill.name, id: flatSkill.id, xpPath: [...path, key], xp: child });
        } else if (typeof child === 'number' && nestedSkill?.id === key) {
          results.push({ name: nestedSkill.name, id: nestedSkill.id, xpPath: [...path, key], xp: child });
        } else if (/skills?/i.test(path.at(-1) || '') && isObject(child) && nestedSkill) {
          const xpKey = Object.keys(child).find(field => /^(xp|experience)$/i.test(field));
          if (xpKey && typeof child[xpKey] === 'number') results.push({ name: nestedSkill.name, id: nestedSkill.id, xpPath: [...path, key, xpKey], xp: child[xpKey] });
        }
      }
    });
    return results
      .filter((entry, index) => results.findIndex(other => other.xpPath.join('.') === entry.xpPath.join('.')) === index)
      .sort((a, b) => {
        const rank = entry => { const found = SKILLS.findIndex(skill => skill.name === entry.name); return found === -1 ? SKILLS.length : found; };
        return rank(a) - rank(b);
      });
  }

  function findItemCatalog(root) {
    const catalog = new Map();
    walk(root, value => {
      for (const child of Object.values(value)) {
        if (!isObject(child) || Array.isArray(child)) continue;
        const idKey = Object.keys(child).find(key => /^(item)?(id|name|type|definition)$/i.test(key));
        if (!idKey || !['string', 'number'].includes(typeof child[idKey])) continue;
        const id = child[idKey];
        const nameKey = Object.keys(child).find(key => /^(display)?name$/i.test(key));
        catalog.set(String(id), { id, name: nameKey ? String(child[nameKey]) : label(id), template: child });
      }
    });
    return [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function findStats(root) {
    const results = [];
    const matcher = /^(health|hp|maxhealth|stamina|mana|armou?r|weight|carryweight|hunger|thirst|energy|specialcharge|sustenance|hydration|coins?|gold|level)$/i;
    // Some saves store a stat as a flat number (Health: 80). Others wrap it
    // in a container object (Health: {CurrentValue: 80}, Sustenance:
    // {SustenanceValue: 100, ...}); this field name detects the actual
    // numeric value inside that container so the wrapped form isn't missed.
    const containerValueField = (containerKey, child) => Object.keys(child).find(field =>
      /^(currentvalue|value|amount)$/i.test(field) || new RegExp(`^${containerKey}(value)?$`, 'i').test(field));
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if (!matcher.test(key)) continue;
        if (typeof child === 'number' || typeof child === 'boolean') {
          results.push({ name: label(key), path: [...path, key], value: child });
        } else if (isObject(child) && !Array.isArray(child)) {
          const field = containerValueField(key, child);
          if (field && typeof child[field] === 'number') results.push({ name: label(key), path: [...path, key, field], value: child[field] });
        }
      }
    });
    return results;
  }

  return {
    SKILLS, SLOT_RANGES, slotInfo, findItemIdentity, findInventories, findSkills, findStats, findItemCatalog,
    getAt, setAt, label, xpForLevel, levelForXp,
    inventoryAdd, inventoryRemoveAt, inventoryReplaceAt, inventoryDuplicateAt
  };
}));
