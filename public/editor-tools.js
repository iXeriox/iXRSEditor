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

  function xpForLevel(level) {
    const target = Math.max(1, Math.min(99, Math.trunc(Number(level) || 1)));
    let points = 0;
    for (let current = 1; current < target; current += 1) points += Math.floor(current + 300 * (2 ** (current / 7)));
    return Math.floor(points / 4);
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
    walk(root, (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'number' && /(xp|experience)$/i.test(key)) {
          results.push({ name: label(key.replace(/(xp|experience)$/i, '') || path.at(-1) || 'Skill'), xpPath: [...path, key], xp: child });
        } else if (/skills?/i.test(path.at(-1) || '') && isObject(child)) {
          const xpKey = Object.keys(child).find(field => /^(xp|experience)$/i.test(field));
          if (xpKey && typeof child[xpKey] === 'number') results.push({ name: label(key), xpPath: [...path, key, xpKey], xp: child[xpKey] });
        }
      }
    });
    return results.filter((entry, index) => results.findIndex(other => other.xpPath.join('.') === entry.xpPath.join('.')) === index);
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

  return { findInventories, findSkills, findStats, getAt, setAt, label, xpForLevel, levelForXp };
}));
