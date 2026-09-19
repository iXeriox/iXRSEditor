'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeSave, encodeSave } = require('../lib/save-codec');
const { SKILLS, findInventories, findSkills, findStats, findItemCatalog, slotInfo, levelForXp, xpForLevel } = require('../public/editor-tools');

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
  const names = ['Agility', 'Fishing', 'Farming', 'Runecrafting', 'Cooking', 'Construction', 'Artisan', 'Woodcutting', 'Mining', 'Ranged', 'Magic', 'Attack'];
  const save = { skills: Object.fromEntries(names.map(name => [name, { experience: 100 }]).concat([['walkingDistance', { experience: 999999 }]])) };
  assert.deepEqual(findSkills(save).map(skill => skill.name), SKILLS.map(skill => skill.name));
});

test('discovers skills by Dragonwilds IDs in maps and records', () => {
  const save = {
    skillXp: { '4pefO9k1lUqfA6mvHNi1SA': 103102 },
    progress: [{ Id: '0hreSMRVXUihq9qjDO2CFA', Name: 'Magic', Experience: 219160 }],
    definitions: [{ Id: 'Wf3i7Ha-B06DH719j1vtBw', Name: 'Artisan' }]
  };
  assert.deepEqual(findSkills(save).map(skill => [skill.name, skill.xp]), [['Attack', 103102], ['Magic', 219160]]);
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

test('maps rangeLocation values to game inventory areas', () => {
  assert.deepEqual([0, 7, 8, 31, 32, 55, 56, 79, 80, 103].map(location => slotInfo(location).name), [
    'Action Bar', 'Action Bar', 'Main Inventory', 'Main Inventory', 'Rune Inventory',
    'Rune Inventory', 'Quest Inventory', 'Quest Inventory', 'Extended Slots', 'Extended Slots'
  ]);
  assert.equal(slotInfo(8).position, 1);
  assert.equal(slotInfo(31).position, 24);
  assert.equal(slotInfo(104).name, 'Unknown Slots');
});
