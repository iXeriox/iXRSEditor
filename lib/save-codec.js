'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeSave, encodeSave } = require('../lib/save-codec');
const {
  SKILLS, findInventories, findSkills, findStats, findItemCatalog, findItemIdentity, slotInfo, levelForXp, xpForLevel,
  inventoryAdd, inventoryRemoveAt, inventoryReplaceAt, inventoryDuplicateAt
} = require('../public/editor-tools');

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

test('prefers an inventory Value over nested modifier IDs', () => {
  const item = {
    modifiers: [{ Id: 'magic-multiplier-id', Name: '(Magic) Rune Cost Multiplier' }],
    item: { Value: 'staff-of-light-id' }, Count: 1
  };
  assert.equal(findItemIdentity(item, ['staff-of-light-id']), 'staff-of-light-id');
});

test('scores deeply nested ItemData references above modifiers', () => {
  const item = {
    properties: [
      { Name: '(Magic) Rune Cost Multiplier', Id: 'magic-multiplier-id' },
      { Name: 'ItemData', Value: { AssetPathName: 'staff-of-light-id' } }
    ]
  };
  assert.equal(findItemIdentity(item, ['magic-multiplier-id', 'staff-of-light-id']), 'staff-of-light-id');
});

test('preserves the original save\'s indentation style on export', () => {
  const pretty = JSON.stringify({ player: { health: 80 } }, null, 2);
  const decoded = decodeSave(Buffer.from(pretty));
  assert.equal(decoded.format.indent, 2);
  assert.equal(encodeSave(decoded.json, decoded.format).toString(), pretty);
  const edited = { ...decoded.json, player: { health: 42 } };
  assert.equal(encodeSave(edited, decoded.format).toString(), JSON.stringify(edited, null, 2));
});

test('keeps minified saves minified on export (no spurious indentation)', () => {
  const compact = JSON.stringify({ player: { health: 80 } });
  const decoded = decodeSave(Buffer.from(compact));
  assert.equal(decoded.format.indent, null);
  assert.equal(encodeSave(decoded.json, decoded.format).toString(), compact);
});

test('detects tab-indented saves and reproduces tabs on export', () => {
  const tabbed = JSON.stringify({ player: { health: 80 } }, null, '\t');
  const decoded = decodeSave(Buffer.from(tabbed));
  assert.equal(decoded.format.indent, '\t');
  assert.equal(encodeSave(decoded.json, decoded.format).toString(), tabbed);
});

test('finds object-keyed slot-map inventories, not just arrays', () => {
  // Dragonwilds stores live inventories as {"0": {...}, "1": {...}, "MaxSlotIndex": N},
  // not JS arrays—this is the shape the real game produces.
  const save = {
    GameProgress: {
      Inventory: { '0': { ItemData: 'axe' }, '3': { ItemData: 'shield' }, MaxSlotIndex: 3 },
      PersonalInventory: { MaxSlotIndex: 0 } // an empty slot map is still a valid, editable group
    }
  };
  const groups = findInventories(save);
  const inventory = groups.find(group => group.name === 'Inventory');
  assert.equal(inventory.kind, 'slotmap');
  assert.deepEqual(inventory.slotNumbers, [0, 3]);
  assert.deepEqual(inventory.items.map(item => item.ItemData), ['axe', 'shield']);
  const personal = groups.find(group => group.name === 'Personal Inventory');
  assert.equal(personal.items.length, 0);
});

test('excludes plain ID-log arrays (e.g. "items picked up") from the inventory list', () => {
  const save = { Progress: { ItemsPickedUp: ['id-a', 'id-b', 'id-c'] } };
  assert.deepEqual(findInventories(save), []);
});

test('inventory mutation helpers write through to the real slot-map keys', () => {
  const raw = { '0': { ItemData: 'axe' }, '2': { ItemData: 'shield' }, MaxSlotIndex: 2 };
  const group = { name: 'Inventory', kind: 'slotmap', raw, items: [raw['0'], raw['2']], slotNumbers: [0, 2] };

  const addedAt = inventoryAdd(group, { ItemData: 'new-item' });
  assert.equal(addedAt, 1); // slot 1 is the first free gap, sorted between slot 0 and slot 2
  assert.equal(raw['1'].ItemData, 'new-item');

  const dupAt = inventoryDuplicateAt(group, 0);
  assert.equal(raw[String(group.slotNumbers[dupAt])].ItemData, 'axe');
  assert.equal(raw.MaxSlotIndex, 3); // duplicate landed in a new slot past the old max, so MaxSlotIndex grows

  inventoryReplaceAt(group, 0, { ItemData: 'replaced' });
  assert.equal(raw['0'].ItemData, 'replaced');

  const lengthBefore = group.items.length;
  inventoryRemoveAt(group, 0);
  assert.equal(raw['0'], undefined);
  assert.equal(group.items.length, lengthBefore - 1);
});

test('inventory mutation helpers still push/splice plain arrays as before', () => {
  const items = [{ id: 'a' }];
  const group = { name: 'Backpack', kind: 'array', items, slotNumbers: [0] };
  inventoryAdd(group, { id: 'b' });
  assert.equal(group.items.length, 2);
  inventoryRemoveAt(group, 0);
  assert.deepEqual(group.items.map(item => item.id), ['b']);
});

test('detects stats wrapped in a value container (e.g. Health.CurrentValue)', () => {
  const save = { GameProgress: { Character: { Health: { CurrentValue: 310 }, Sustenance: { SustenanceValue: 100 } } } };
  const stats = findStats(save);
  assert.deepEqual(stats.map(stat => [stat.name, stat.value]).sort(), [['Health', 310], ['Sustenance', 100]]);
  assert.deepEqual(stats.find(stat => stat.name === 'Health').path.slice(-2), ['Health', 'CurrentValue']);
});

test('surfaces skill records with unrecognized IDs instead of silently dropping them', () => {
  // The hardcoded SKILLS table doesn't ship confirmed IDs for Fishing/Agility;
  // any other {Id, Xp} record inside a "Skills" array should still show up.
  const save = { GameProgress: { Skills: { Skills: [{ Id: '4pefO9k1lUqfA6mvHNi1SA', Xp: 100 }, { Id: 'unknown-fishing-id', Xp: 50000 }] } } };
  const skills = findSkills(save);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, 'Attack');
  assert.equal(skills[1].name, null);
  assert.equal(skills[1].id, 'unknown-fishing-id');
  assert.equal(skills[1].xp, 50000);
});