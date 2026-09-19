# Dragonwilds Save Editor

A dependency-free Node.js web editor for RuneScape: Dragonwilds save payloads, including Xbox Game Pass WGS data blobs.

## Run

```bash
npm start
```

Open `http://localhost:3000`. Select the extensionless GUID-named data blob from the game's WGS folder—not `container.index`. The editor detects plain JSON, UTF-16 JSON, gzip, zlib, raw-deflate, and Brotli payloads, and preserves any text envelope while exporting in the original format.

The structured workspace automatically discovers common inventory arrays, character stats, and skill XP fields without assuming one fixed save schema. Its searchable item editor can add, duplicate, remove, and edit items already represented in the save. The skill editor recognizes Dragonwilds' stable skill IDs as well as named fields for Attack, Magic, Ranged, Mining, Woodcutting, Artisan, Construction, Cooking, Runecrafting, Farming, Fishing, and Agility. Its 1–99 curve is calibrated to the supplied in-game thresholds (103,735 XP for level 63 and 223,122 XP for level 80), while telemetry such as walking distance is excluded. The complete JSON editor remains available for uncommon or newly-added fields.

When a `Data/` directory is present, the server recursively indexes its JSON files and matches records containing an ID and name. Images from `images/` or `Data/images/` are matched by ID or name and displayed in the item editor. Item-like data files also populate the add-item picker without hard-coding a particular dataset layout.

Always close the game and back up the complete WGS directory before replacing a save. WGS metadata and Xbox cloud synchronization are managed by the Xbox app; export the edited blob under its original filename and replace it in the original directory while the game is closed.

## Configuration

- `PORT` — listening port (default `3000`)
- `HOST` — listening address (default `0.0.0.0`)
- Maximum upload size: 100 MB

## Tests

```bash
npm test
```
