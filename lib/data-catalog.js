'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const DATA_EXTENSIONS = new Set(['.json']);

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else result.push(filename);
    }
  };
  visit(root);
  return result;
}

function recordsFrom(value, source, category, output = []) {
  if (Array.isArray(value)) {
    value.forEach(child => recordsFrom(child, source, category, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const idKey = Object.keys(value).find(key => /^(id|itemid|skillid|guid|key)$/i.test(key));
  const nameKey = Object.keys(value).find(key => /^(name|displayname|label|title)$/i.test(key));
  if (idKey && nameKey && ['string', 'number'].includes(typeof value[idKey])) {
    output.push({ id: String(value[idKey]), name: String(value[nameKey]), category, source, data: value });
    return output;
  }
  Object.values(value).forEach(child => recordsFrom(child, source, category, output));
  return output;
}

function normalizedKey(value) { return String(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function loadCatalog(projectRoot) {
  const dataRoot = path.join(projectRoot, 'Data');
  const imageRoots = [path.join(projectRoot, 'images'), path.join(dataRoot, 'images')];
  const images = new Map();
  for (const imageRoot of imageRoots) {
    for (const filename of filesBelow(imageRoot)) {
      if (!IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())) continue;
      const relative = path.relative(projectRoot, filename).split(path.sep).map(encodeURIComponent).join('/');
      images.set(normalizedKey(path.basename(filename, path.extname(filename))), `/catalog-assets/${relative}`);
    }
  }

  const entries = [];
  for (const filename of filesBelow(dataRoot)) {
    if (!DATA_EXTENSIONS.has(path.extname(filename).toLowerCase())) continue;
    try {
      const relative = path.relative(dataRoot, filename).split(path.sep).join('/');
      const category = path.basename(filename, path.extname(filename));
      recordsFrom(JSON.parse(fs.readFileSync(filename, 'utf8')), relative, category, entries);
    } catch (error) {
      entries.push({ error: `Unable to read ${path.relative(dataRoot, filename)}: ${error.message}` });
    }
  }

  const valid = entries.filter(entry => !entry.error).map(entry => ({
    ...entry,
    image: images.get(normalizedKey(entry.id)) || images.get(normalizedKey(entry.name)) || null
  }));
  return {
    available: fs.existsSync(dataRoot),
    entries: valid,
    errors: entries.filter(entry => entry.error).map(entry => entry.error),
    counts: valid.reduce((counts, entry) => ({ ...counts, [entry.category]: (counts[entry.category] || 0) + 1 }), {})
  };
}

module.exports = { loadCatalog, recordsFrom };
