# Dragonwilds Save Editor

A dependency-free Node.js web editor for RuneScape: Dragonwilds save payloads, including Xbox Game Pass WGS data blobs.

## Run

```bash
npm start
```

Open `http://localhost:3000`. Select the extensionless GUID-named data blob from the game's WGS folder—not `container.index`. The editor detects plain JSON, UTF-16 JSON, gzip, zlib, raw-deflate, and Brotli payloads, and preserves the original text envelope **and indentation style** while exporting: an indented save is re-exported indented, byte-for-byte identical if nothing was changed, instead of being silently collapsed to minified JSON.

The structured workspace automatically discovers character stats, skill XP fields, and inventories without assuming one fixed save schema. Live Dragonwilds saves store `Inventory`, `Loadout`, and `PersonalInventory` as **slot maps**—objects keyed by slot index (`{"0": {...}, "1": {...}, "MaxSlotIndex": 90}`)—rather than JS arrays; these are detected and fully editable, with new items landing in the correct slot and `MaxSlotIndex` kept in sync. Plain ID-log arrays (e.g. a "items picked up" achievement log) are recognized and excluded so they don't get mistaken for a real inventory. A small number of gear slots reference an item by inventory index instead of embedding it directly; the editor resolves that reference so equipped items still display correctly instead of showing as empty.

Its searchable item editor can add, duplicate, remove, and edit items already represented in the save. The skill editor recognizes Dragonwilds' stable skill IDs as well as named fields for Attack, Magic, Ranged, Mining, Woodcutting, Artisan, Construction, Cooking, Runecrafting, and Farming. Fishing and Agility don't have confirmed IDs yet, so those two are still shown—using a name resolved from the loaded item/skill catalog when possible, or a short label built from the raw ID—rather than silently dropped. Its 1–99 curve is calibrated to the supplied in-game thresholds (103,735 XP for level 63 and 223,122 XP for level 80), while telemetry such as walking distance is excluded. The complete JSON editor remains available for uncommon or newly-added fields.

When a `Data/` directory is present, the server recursively indexes its JSON files and matches records containing an ID and name. Images from `images/` or `Data/images/` are matched by ID or name and displayed in the item editor. Item-like data files also populate the add-item picker without hard-coding a particular dataset layout.

The catalog accepts both arrays of item records and RSDWTools-style objects keyed by item ID. Common camel-case, Pascal-case, and snake-case fields—such as `itemId`, `display_name`, and `image_url`—are normalized automatically. Image hints in the catalog are matched to local artwork by filename.

The RSDWTools `Items.json` schema is supported directly: `itemData` is the identifier stored in inventory `Value` fields, `name` is the friendly display name, `iconPath` selects the corresponding image, `maxStack` supplies slot capacity, and `category` is shown in the item browser.

The inventory workspace is split into two areas: the user's slots and an illustrated, name/ID-searchable item catalog. Catalog items can be clicked to add them or dragged directly onto an existing slot to replace it. Slots show resolved names and images from `Items.json`, explicit slot labels, secondary ID details, stack quantity/capacity badges, bounded quantity steppers, duplication, and removal controls. Stats are grouped into Vitals, Survival, Combat, Currency, and Character sections, with stepper controls and refill actions where a matching maximum value exists. Stats stored as a wrapped value (e.g. `Health: {CurrentValue: 310}`, as in live Dragonwilds saves) are detected the same as a flat number.

Inventory cards identify their real game area—0–7 Action Bar, 8–31 Main Inventory, 32–55 Rune Inventory, 56–79 Quest Inventory, 80–103 Extended Slots—from the item's actual slot number: for slot-map inventories that's the object key itself, and for older array-based saves it falls back to a nested `rangeLocation` field. The card badge shows its area-relative slot number while its tooltip retains the raw slot index.

Item identity resolution prioritizes catalog-matching `Value`/`itemData` fields over nested modifier IDs, preventing effects such as “(Magic) Rune Cost Multiplier” from being mistaken for the equipped item, and matches IDs by exact case first since Dragonwilds' base64-style IDs are case-sensitive. Inventory slots use a compact game-like grid; less common raw properties are available under each card's **More details** disclosure.

Opening a save now waits for `/api/catalog` to finish, and the Inventory header reports how many `Items.json` records loaded (or displays the catalog error). Identity matching scores nested `ItemData`, `Value`, asset-path, and item-definition contexts while penalizing modifier/stat contexts.

Always close the game and back up the complete WGS directory before replacing a save. WGS metadata and Xbox cloud synchronization are managed by the Xbox app; export the edited blob under its original filename and replace it in the original directory while the game is closed.

## Configuration

- `PORT` — listening port (default `3000`)
- `HOST` — listening address (default `0.0.0.0`)
- Maximum upload size: 100 MB

## Tests

```bash
npm test
```

