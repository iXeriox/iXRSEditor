(function expose(root, factory) {
  const tools = factory();
  if (typeof module === 'object' && module.exports) module.exports = tools;
  else root.EditorTools = tools;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const isObject = value => value && typeof value === 'object';

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

  // Dragonwilds uses a flatter curve than RuneScape. Level 63 starts at
  // 103,735 XP (the next-level threshold shown for level 62 in-game).
  const LEVEL_63_XP = 103735;
  function xpForLevel(level) {
    const target = Math.max(1, Math.min(99, Math.trunc(Number(level) || 1)));
    return Math.floor(((target - 1) ** 2 * LEVEL_63_XP) / (62 ** 2));
  }

  function levelForXp(xp) {
    const amount = Math.max(0, Number(xp) || 0);
    for (let level = 99; level > 1; level -= 1) if (amount >= xpForLevel(level)) return level;
    return 1;
  }

  function findInventories(root) {
    const results = [];
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if (Array.isArray(child) && /(inventory|backpack|storage|bank|items|slots)/i.test(key)) results.push({ name: label(key), path: [...path, key], items: child });
      }
    });
    return results.filter((entry, index) => results.findIndex(other => other.items === entry.items) === index);
  }

  function findSkills(root) {
    const results = [];
    const skillNames = /^(attack|magic|ranged|woodcutting|mining|artisan|construction|cooking|farming|crafting|smithing|fishing)$/i;
    const nonSkills = /(walk|distance|travel|telemetry|time|duration|coordinate|location)/i;
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        const strippedKey = key.replace(/(xp|experience)$/i, '');
        const inSkillContainer = /skills?|experience/i.test(path.at(-1) || '');
        if (typeof child === 'number' && /(xp|experience)$/i.test(key) && !nonSkills.test(key) && (skillNames.test(strippedKey) || inSkillContainer)) {
          results.push({ name: label(strippedKey || path.at(-1) || 'Skill'), xpPath: [...path, key], xp: child });
        } else if (/skills?/i.test(path.at(-1) || '') && isObject(child)) {
          const xpKey = Object.keys(child).find(field => /^(xp|experience)$/i.test(field));
          if (xpKey && typeof child[xpKey] === 'number') results.push({ name: label(key), xpPath: [...path, key, xpKey], xp: child[xpKey] });
        }
      }
    });
    return results.filter((entry, index) => results.findIndex(other => other.xpPath.join('.') === entry.xpPath.join('.')) === index);
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
    const matcher = /^(health|hp|maxhealth|stamina|mana|armou?r|weight|carryweight|hunger|thirst|energy|coins?|gold|level)$/i;
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if ((typeof child === 'number' || typeof child === 'boolean') && matcher.test(key)) results.push({ name: label(key), path: [...path, key], value: child });
      }
    });
    return results;
  }

  return { findInventories, findSkills, findStats, findItemCatalog, getAt, setAt, label, xpForLevel, levelForXp };
}));
