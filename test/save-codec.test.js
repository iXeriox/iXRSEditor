'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeSave, encodeSave } = require('../lib/save-codec');
const { findInventories, findSkills, findStats, findItemCatalog, levelForXp, xpForLevel } = require('../public/editor-tools');

const example = { player: { name: 'Ember', level: 42 }, inventory: [1, 2] };

test('round trips plain JSON', () => {
  const decoded = decodeSave(Buffer.from(JSON.stringify(example)));
  assert.deepEqual(decoded.json, example);
  assert.deepEqual(decodeSave(encodeSave({ ...example, changed: true }, decoded.format)).json.changed, true);
});

test('detects and preserves gzip compression', () => {
  const decoded = decodeSave(zlib.gzipSync(Buffer.from(JSON.stringify(example))));
  assert.equal(decoded.format.compression, 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(encodeSave(example, decoded.format))), example);
});

test('preserves an embedded JSON text envelope', () => {
  const decoded = decodeSave(Buffer.from(`HEADER:${JSON.stringify(example)}:FOOTER`));
  const encoded = encodeSave({ edited: true }, decoded.format).toString();
  assert.equal(encoded, 'HEADER:{"edited":true}:FOOTER');
});

test('rejects unsupported binary data', () => {
  assert.throws(() => decodeSave(Buffer.from([0, 1, 2, 3])), /Unsupported save/);
});

test('calculates Dragonwilds levels from XP shown in game', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(63), 103735);
  assert.equal(xpForLevel(80), 223122);
  assert.equal(levelForXp(103102), 62);
  assert.equal(levelForXp(103735), 63);
  assert.equal(levelForXp(219160), 79);
  assert.equal(levelForXp(223122), 80);
});

test('returns only the twelve Dragonwilds skills in game order', () => {
  const names = ['Agility', 'Fishing', 'Farming', 'RuneCrafting', 'Cooking', 'Construction', 'Artisan', 'Woodcutting', 'Mining', 'Range', 'Magic', 'Attack'];
  const save = { skills: Object.fromEntries(names.map(name => [name, { experience: 100 }]).concat([['walkingDistance', { experience: 999999 }]])) };
  assert.deepEqual(findSkills(save).map(skill => skill.name), ['Attack', 'Magic', 'Range', 'Mining', 'Woodcutting', 'Artisan', 'Construction', 'Cooking', 'RuneCrafting', 'Farming', 'Fishing', 'Agility']);
});

test('discovers structured editor data in nested saves', () => {
  const save = { player: { health: 80, walkingDistanceExperience: 999999, inventory: [{ itemId: 'axe', name: 'Bronze Axe', quantity: 2 }], skills: { woodcutting: { xp: 1000 } } } };
  assert.equal(findInventories(save)[0].items[0].itemId, 'axe');
  assert.equal(findStats(save)[0].name, 'Health');
  assert.equal(findSkills(save)[0].name, 'Woodcutting');
  assert.equal(findSkills(save).length, 1);
  assert.equal(levelForXp(findSkills(save)[0].xp), 15);
  assert.equal(findItemCatalog(save)[0].name, 'Bronze Axe');
});
