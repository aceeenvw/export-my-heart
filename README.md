# Export My Heart

SillyTavern extension for selective bulk export and import of character cards with a visual grid interface.

## Features

### Export
- **Visual character grid** — browse all characters as avatar cards, click to select
- **Selective export** — pick exactly which characters to include in the ZIP
- **Select All / Deselect** — one-click bulk selection of visible characters
- **Search** — real-time character name filtering
- **Tag filtering** — clickable tag pills to narrow down by category
- **Progress tracking** — live progress bar with per-character status
- **Cancel anytime** — abort mid-export without losing already packed files
- **Error log** — failed exports are saved as `_errors.txt` inside the ZIP

### Import
- **Drag & drop** — drop `.png` or `.json` character files directly onto the import zone
- **Click to browse** — opens native file picker
- **Bulk import** — select or drop multiple files at once
- **Auto-refresh** — character grid updates automatically after import

## Installation

1. Download or clone this repository
2. Place the folder in `SillyTavern/data/default-user/extensions/`
3. Restart SillyTavern or reload the page
4. Find the extension in **Extensions** panel → **Export My Heart**

## Usage

### Exporting

1. Open the **Export My Heart** drawer in the Extensions panel
2. Browse the character grid — use search or tag filters to narrow down
3. Click individual cards to select them, or use **Select All** (✓✓) for everything visible
4. Press **Export** — progress bar shows each character being packed
5. ZIP downloads automatically when done

### Importing

1. Drag `.png` / `.json` character files onto the drop zone
2. Or click the drop zone and select files from disk (multiple selection supported)
3. Progress bar tracks each file being imported
4. Grid refreshes automatically with new characters

## Supported Formats

| Action | Formats |
|--------|---------|
| Export | `.png` (character card with embedded metadata) → packed into `.zip` |
| Import | `.png`, `.json` (SillyTavern character card formats) |

## Technical Details

- JSZip loaded dynamically from CDN (`3.10.1`, pinned version)
- DEFLATE compression, level 6
- Duplicate character names handled automatically (appends counter)
- Debounced search (180ms) for smooth filtering
- Lazy-loaded avatars for performance on large libraries
- Deferred grid render — polls for character data availability at startup

## Version

**v3.0.0** — by aceenvw

## License

Free to use and modify.
