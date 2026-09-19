# Dragonwilds Save Editor

A dependency-free Node.js web editor for RuneScape: Dragonwilds save payloads, including Xbox Game Pass WGS data blobs.

## Run

```bash
npm start
```

Open `http://localhost:3000`. Select the extensionless GUID-named data blob from the game's WGS folder—not `container.index`. The editor detects plain JSON, UTF-16 JSON, gzip, zlib, raw-deflate, and Brotli payloads, and preserves any text envelope while exporting in the original format.

The structured workspace automatically discovers common inventory arrays, character stats, and skill XP fields without assuming one fixed save schema. Skill levels use the standard RuneScape XP curve and are capped from level 1 through 99. The complete JSON editor remains available for uncommon or newly-added fields.

Always close the game and back up the complete WGS directory before replacing a save. WGS metadata and Xbox cloud synchronization are managed by the Xbox app; export the edited blob under its original filename and replace it in the original directory while the game is closed.

## Configuration

- `PORT` — listening port (default `3000`)
- `HOST` — listening address (default `0.0.0.0`)
- Maximum upload size: 100 MB

## Tests

```bash
npm test
```
