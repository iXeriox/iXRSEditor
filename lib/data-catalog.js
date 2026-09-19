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

const normalizedField = key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const ID_FIELDS = new Set(['id', 'itemid', 'itemguid', 'guid', 'key', 'assetid', 'definitionid', 'itemdefinitionid']);
const NAME_FIELDS = new Set(['name', 'itemname', 'displayname', 'label', 'title']);
const IMAGE_FIELDS = new Set(['image', 'imageurl', 'icon', 'iconurl', 'thumbnail', 'sprite']);

function fieldMatching(value, names) { return Object.keys(value).find(key => names.has(normalizedField(key))); }

function recordsFrom(value, source, category, output = [], inheritedId = null) {
  if (Array.isArray(value)) {
    value.forEach(child => recordsFrom(child, source, category, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const idKey = fieldMatching(value, ID_FIELDS);
  const nameKey = fieldMatching(value, NAME_FIELDS);
  const imageKey = fieldMatching(value, IMAGE_FIELDS);
  const id = idKey ? value[idKey] : inheritedId;
  if (id != null && nameKey && ['string', 'number'].includes(typeof id)) {
    output.push({ id: String(id), name: String(value[nameKey]), category, source, imageHint: imageKey ? String(value[imageKey]) : null, data: value });
  }
  for (const [key, child] of Object.entries(value)) recordsFrom(child, source, category, output, key);
  return output;
}

function normalizedKey(value) { return String(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function loadCatalog(projectRoot) {
  const dataRoot = path.join(projectRoot, 'Data');
  const imageRoots = [
    path.join(projectRoot, 'images'), path.join(projectRoot, 'Images'),
    path.join(dataRoot, 'images'), path.join(dataRoot, 'Images'),
    path.join(projectRoot, 'public', 'images'), path.join(projectRoot, 'public', 'Images')
  ];
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

  const valid = entries.filter(entry => !entry.error).map(entry => {
    const imageBasename = entry.imageHint ? path.basename(entry.imageHint, path.extname(entry.imageHint)) : '';
    return {
      ...entry,
      image: images.get(normalizedKey(entry.id)) || images.get(normalizedKey(entry.name)) || images.get(normalizedKey(imageBasename)) || (/^https?:\/\//i.test(entry.imageHint || '') ? entry.imageHint : null)
    };
  });
  return {
    available: fs.existsSync(dataRoot),
    entries: valid,
    errors: entries.filter(entry => entry.error).map(entry => entry.error),
    counts: valid.reduce((counts, entry) => ({ ...counts, [entry.category]: (counts[entry.category] || 0) + 1 }), {})
  };
}

module.exports = { loadCatalog, recordsFrom };
