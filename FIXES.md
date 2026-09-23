# What changed

Tested against your actual save (`iXeriox`, version 83, 458 saves). All fixes verified against that real data, not just synthetic test cases.

## Critical

- **Export corrupted formatting.** Your WGS blob is indented JSON (2-space,
  6188 lines). Export re-serialized with `JSON.stringify(json)` — no
  indentation — shrinking a 196,928-byte save to 134,201 bytes on every
  export. Fixed: the codec now detects the original indent style (spaces,
  width, or tabs) on decode and reproduces it on encode. An unmodified
  round trip is now byte-for-byte identical to the original file.

- **The real inventory was never detected.** Live Dragonwilds saves store
  `Inventory`, `Loadout`, and `PersonalInventory` as *objects* keyed by slot
  index (`{"0": {...}, "56": {...}, "MaxSlotIndex": 90}`), not JS arrays.
  The old inventory finder only matched `Array.isArray(...)`, so all three
  were skipped — instead it picked up `Progress.ItemsPickedUp` (a 360-entry
  "items ever seen" log) and displayed *that* as your inventory. Rewrote
  inventory detection to recognize these slot-map objects, added
  `loadout`/`equip`/`hotbar` to the name match, and excluded plain ID-log
  arrays. New add/remove/duplicate/replace helpers keep the object's real
  keys and `MaxSlotIndex` correct. Verified: all 53 real items in your
  inventory now resolve against `Items.json`, and add/duplicate/remove
  round-trip correctly through export.

- **Stats tab was empty.** `Health`, `Stamina`, etc. are wrapped
  (`Health: {CurrentValue: 310}`), not flat numbers, so the old matcher
  found nothing. Now detects one level of wrapping (`CurrentValue`,
  `SustenanceValue`, `HydrationValue`, ...). Your save now shows Health,
  Stamina, Special Charge, Sustenance, and Hydration.

## Smaller but real

- **2 of your 12 skills were silently dropped.** Fishing and Agility don't
  have confirmed IDs in the skill table; they were matched by nothing and
  disappeared. Now any `{Id, Xp}` record found inside a `Skills` container
  is surfaced — using a catalog-resolved name when possible, otherwise a
  short label built from the raw ID — instead of vanishing.
- **2 of your Loadout slots showed "Empty slot".** Those entries reference
  an item by inventory index (`{"PlayerInventoryItemIndex": 56}`) rather
  than embedding it. The editor now resolves that reference for display.
- **Case-sensitive ID collision risk.** Item-ID matching lowercased
  everything before comparing; Dragonwilds IDs are case-sensitive, so two
  different items differing only by case could theoretically resolve to the
  wrong one. Now matches exact case first, falling back to the lenient
  comparison only if nothing exact is found.
- Drop-to-add now works anywhere in an inventory's empty space (previously
  required hitting an exact, easy-to-miss target), and an empty slot map
  (like your `PersonalInventory`) now shows a helpful empty state instead
  of a blank box.

## Verification

- 28 automated tests (19 original + 9 new), all passing.
- End-to-end smoke test: loaded your actual save file through the real
  server and DOM, edited a stat, duplicated/removed inventory items,
  exported, and re-decoded the export to confirm the edits and formatting
  both survived correctly, with zero runtime errors.
