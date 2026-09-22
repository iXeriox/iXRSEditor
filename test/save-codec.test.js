'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const vm = require('node:vm');
const { decodeSave, encodeSave } = require('../lib/save-codec');
const {
  SKILLS, findInventories, findSkills, findStats, findItemCatalog, findItemIdentity, slotInfo, levelForXp, xpForLevel,
  inventoryAdd, inventoryRemoveAt, inventoryReplaceAt, inventoryDuplicateAt
} = require('../public/editor-tools');

const example = { player: { name: 'Ember', level: 42 }, inventory: [1, 2] };

test('editor tools script parses and exposes its browser global', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/editor-tools'), 'utf8'), browser);
  assert.equal(typeof browser.EditorTools.findSkills, 'function');
});

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

test('uses an explicit saved skill level instead of inferring it from XP', () => {
  const save = { skills: [{ Id: '0hreSMRVXUihq9qjDO2CFA', Experience: 219160, Level: 96 }] };
  const [magic] = findSkills(save);
  assert.equal(magic.name, 'Magic');
  assert.equal(magic.level, 96);
  assert.deepEqual(magic.levelPath, ['skills', '0', 'Level']);
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

test('preserves the original save indentation and encoding details', () => {
  for (const indent of [null, 2, '\t']) {
    const text = JSON.stringify({ player: { health: 80 } }, null, indent || undefined);
    const decoded = decodeSave(Buffer.from(text));
    assert.equal(decoded.format.indent, indent);
    assert.equal(encodeSave(decoded.json, decoded.format).toString(), text);
  }

  const utf16 = Buffer.from(`\uFEFF${JSON.stringify(example, null, 2)}`, 'utf16le');
  const decoded = decodeSave(utf16);
  assert.equal(decoded.format.encoding, 'utf16le');
  assert.deepEqual(encodeSave(decoded.json, decoded.format), utf16);
});

test('finds and mutates object-keyed slot-map inventories', () => {
  const save = { GameProgress: {
    Inventory: { '0': { ItemData: 'axe' }, '3': { ItemData: 'shield' }, MaxSlotIndex: 3 },
    PersonalInventory: { MaxSlotIndex: 0 }
  } };
  const groups = findInventories(save);
  const inventory = groups.find(group => group.name === 'Inventory');
  assert.equal(inventory.kind, 'slotmap');
  assert.deepEqual(inventory.slotNumbers, [0, 3]);
  assert.deepEqual(inventory.items.map(item => item.ItemData), ['axe', 'shield']);
  assert.equal(groups.find(group => group.name === 'Personal Inventory').items.length, 0);

  assert.equal(inventoryAdd(inventory, { ItemData: 'new-item' }), 1);
  assert.equal(inventory.raw['1'].ItemData, 'new-item');
  const duplicateIndex = inventoryDuplicateAt(inventory, 0);
  assert.equal(inventory.raw[String(inventory.slotNumbers[duplicateIndex])].ItemData, 'axe');
  assert.equal(inventory.raw.MaxSlotIndex, 3);
  inventoryReplaceAt(inventory, 0, { ItemData: 'replaced' });
  assert.equal(inventory.raw['0'].ItemData, 'replaced');
  inventoryRemoveAt(inventory, 0);
  assert.equal(inventory.raw['0'], undefined);
});

test('excludes ID logs while retaining and mutating array inventories', () => {
  assert.deepEqual(findInventories({ Progress: { ItemsPickedUp: ['id-a', 'id-b'] } }), []);
  const items = [{ id: 'a' }];
  const group = { name: 'Backpack', kind: 'array', items };
  inventoryAdd(group, { id: 'b' });
  inventoryRemoveAt(group, 0);
  assert.deepEqual(items.map(item => item.id), ['b']);
});

test('detects wrapped stats and unknown skill records', () => {
  const save = { GameProgress: {
    Character: { Health: { CurrentValue: 310 }, Sustenance: { SustenanceValue: 100 } },
    Skills: { Skills: [{ Id: '4pefO9k1lUqfA6mvHNi1SA', Xp: 100 }, { Id: 'unknown-fishing-id', Xp: 50000 }] }
  } };
  const stats = findStats(save);
  assert.deepEqual(stats.map(stat => [stat.name, stat.value]).sort(), [['Health', 310], ['Sustenance', 100]]);
  assert.deepEqual(stats.find(stat => stat.name === 'Health').path.slice(-2), ['Health', 'CurrentValue']);
  const skills = findSkills(save);
  assert.deepEqual(skills.map(skill => [skill.name, skill.id, skill.xp]), [
    ['Attack', '4pefO9k1lUqfA6mvHNi1SA', 100],
    [null, 'unknown-fishing-id', 50000]
  ]);
});
