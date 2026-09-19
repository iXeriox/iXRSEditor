'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCatalog, recordsFrom } = require('../lib/data-catalog');

test('extracts ID/name records from nested JSON shapes', () => {
  const records = recordsFrom({ payload: [{ Id: 'axe-id', Name: 'Bronze Axe', Damage: 4 }] }, 'items.json', 'items');
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'axe-id');
  assert.equal(records[0].name, 'Bronze Axe');
  assert.equal(records[0].data.Damage, 4);
});

test('supports RSDWTools-style ID-keyed catalogs and snake-case fields', () => {
  const records = recordsFrom({ items: {
    'Wf3i7Ha-B06DH719j1vtBw': { display_name: 'Artisan Token', image_url: 'icons/artisan.png', max_stack: 99 },
    axe: { item_name: 'Bronze Axe' }
  } }, 'Items.json', 'Items');
  assert.deepEqual(records.map(record => [record.id, record.name, record.imageHint]), [
    ['Wf3i7Ha-B06DH719j1vtBw', 'Artisan Token', 'icons/artisan.png'],
    ['axe', 'Bronze Axe', null]
  ]);
});

test('indexes Data JSON and associates images by ID', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragonwilds-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Data', 'items'), { recursive: true });
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Data', 'items', 'weapons.json'), JSON.stringify([{ itemId: 'axe-id', displayName: 'Bronze Axe' }]));
  fs.writeFileSync(path.join(root, 'images', 'axe-id.png'), 'image');
  const catalog = loadCatalog(root);
  assert.equal(catalog.available, true);
  assert.equal(catalog.entries[0].name, 'Bronze Axe');
  assert.equal(catalog.entries[0].image, '/catalog-assets/images/axe-id.png');
});

test('associates catalog image hints with local artwork', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragonwilds-hints-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Data', 'images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Data', 'Items.json'), JSON.stringify({ axe: { name: 'Bronze Axe', icon: 'ui/bronze-axe.webp' } }));
  fs.writeFileSync(path.join(root, 'Data', 'images', 'bronze-axe.webp'), 'image');
  assert.equal(loadCatalog(root).entries[0].image, '/catalog-assets/Data/images/bronze-axe.webp');
});

test('discovers artwork in an uppercase Images directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragonwilds-uppercase-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Data', 'Items.json'), JSON.stringify([{ Id: 'sword-id', Name: 'Bronze Sword' }]));
  fs.writeFileSync(path.join(root, 'Images', 'sword-id.png'), 'image');
  assert.equal(loadCatalog(root).entries[0].image, '/catalog-assets/Images/sword-id.png');
});

test('returns an empty catalog when Data is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragonwilds-empty-'));
  try { assert.deepEqual(loadCatalog(root), { available: false, entries: [], errors: [], counts: {} }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
