# Export All Cards ZIP

SillyTavern extension for bulk export and import of character cards.

## Features

- **Bulk Export** — Export all your characters as PNG files in a single ZIP archive
- **Tag Filtering** — Select specific tags to export only certain characters
- **Preview Before Export** — See the list of characters that will be exported
- **Drag & Drop Import** — Import characters back by dropping a ZIP file
- **Progress Tracking** — Real-time progress bar and status updates
- **Error Handling** — Failed exports are logged in `_export_errors.txt` inside the ZIP

## Installation

1. Download or clone this repository
2. Place the folder in `SillyTavern/public/scripts/extensions/`
3. Restart SillyTavern or reload the page
4. Find the extension in **Extensions** → **Export All Cards ZIP**

## Usage

### Export Characters

1. Open the extension panel
2. (Optional) Select tags to filter which characters to export
3. Click **Export as ZIP**
4. Review the preview list
5. Confirm to start the export
6. The ZIP file will download automatically

### Import Characters

1. Drag and drop a ZIP file into the import zone
2. Or click the zone to select a file
3. Characters will be imported automatically

## Technical Details

- Uses JSZip library (loaded dynamically from CDN)
- Exports characters in PNG format with embedded metadata
- Handles duplicate names automatically
- Compression level: 6 (balanced speed/size)

## Version

**v2.0.0** — by aceenvw

## License

Free to use and modify.
