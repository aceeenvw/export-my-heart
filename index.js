// Export All Cards ZIP v2.0 — by aceenvw
const MODULE_NAME = 'export_all_cards_zip';

let abortExport = false;
let jsZipLoaded = false;

// ─── Load JSZip dynamically ───
async function loadJSZip() {
    if (jsZipLoaded && window.JSZip) return true;
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => { jsZipLoaded = true; resolve(true); };
        script.onerror = () => { console.error(`[${MODULE_NAME}] Failed to load JSZip`); resolve(false); };
        document.head.appendChild(script);
    });
}

function getHeaders() {
    if (typeof window.getRequestHeaders === 'function') return window.getRequestHeaders();
    const ctx = SillyTavern.getContext();
    if (typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
    return { 'Content-Type': 'application/json' };
}

function safeName(name) {
    return name.replace(/[^a-zA-Z0-9_\-\u0400-\u04FF ().]/g, '_');
}

function setStatus(text) {
    $('#export_cards_status').text(text);
}

function setProgress(pct) {
    $('#export-cards-progress-bar').show();
    $('#export-cards-progress-fill').css('width', `${pct}%`);
}

function resetUI() {
    $('#export-cards-btn').removeClass('disabled').css('pointer-events', '');
    $('#export-cards-cancel-btn').hide();
    $('#export-cards-progress-fill').css('width', '0%');
    $('#export-cards-progress-bar').hide();
    $('#export-cards-preview').hide();
    setStatus('');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getUniqueName(usedNames, baseName) {
    let name = baseName;
    let counter = 2;
    while (usedNames.has(name)) {
        name = `${baseName} (${counter})`;
        counter++;
    }
    usedNames.add(name);
    return name;
}

// ─── Fetch single character as PNG blob ───
async function fetchCharacterPng(avatarUrl) {
    const headers = getHeaders();
    try {
        const r = await fetch('/api/characters/export', {
            method: 'POST',
            headers,
            body: JSON.stringify({ format: 'png', avatar_url: avatarUrl }),
        });
        if (r.ok) {
            const blob = await r.blob();
            if (blob && blob.size > 0) return blob;
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Export failed:`, e);
    }
    return null;
}

// ─── Get all available tags ───
function getAllTags() {
    const ctx = SillyTavern.getContext();
    const tags = new Set();
    ctx.characters.forEach(char => {
        if (char.tags && Array.isArray(char.tags)) {
            char.tags.forEach(tag => tags.add(tag));
        }
    });
    return Array.from(tags).sort();
}

// ─── Filter characters by selected tags ───
function filterCharactersByTags(characters, selectedTags) {
    if (selectedTags.length === 0) return characters;
    return characters.filter(char => {
        if (!char.tags || !Array.isArray(char.tags)) return false;
        return selectedTags.some(tag => char.tags.includes(tag));
    });
}

// ─── Show preview modal ───
function showPreviewModal(characters, onConfirm) {
    const list = characters.map(c => `<li>${c.name || 'unnamed'}</li>`).join('');
    const html = `
        <div id="export-preview-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;">
            <div style="background:var(--SmartThemeBodyColor);padding:20px;border-radius:8px;max-width:500px;max-height:70vh;overflow:auto;">
                <h3>Export Preview</h3>
                <p>Characters to export: <strong>${characters.length}</strong></p>
                <ul style="max-height:300px;overflow-y:auto;margin:10px 0;">${list}</ul>
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button id="export-preview-confirm" class="menu_button" style="flex:1;">Export</button>
                    <button id="export-preview-cancel" class="menu_button" style="flex:1;">Cancel</button>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);
    $('#export-preview-confirm').on('click', () => {
        $('#export-preview-modal').remove();
        onConfirm();
    });
    $('#export-preview-cancel').on('click', () => {
        $('#export-preview-modal').remove();
    });
}

// ─── Main export function ───
async function exportAllAsZip() {
    const ctx = SillyTavern.getContext();
    let characters = ctx.characters;

    if (!characters || characters.length === 0) {
        toastr.warning('No characters found.');
        return;
    }

    // Filter by selected tags
    const selectedTags = [];
    $('#export-tags-filter input:checked').each(function() {
        selectedTags.push($(this).val());
    });

    if (selectedTags.length > 0) {
        characters = filterCharactersByTags(characters, selectedTags);
        if (characters.length === 0) {
            toastr.warning('No characters match selected tags.');
            return;
        }
    }

    // Show preview modal
    showPreviewModal(characters, async () => {
        await performExport(characters);
    });
}

async function performExport(characters) {
    abortExport = false;
    $('#export-cards-btn').addClass('disabled').css('pointer-events', 'none');
    $('#export-cards-cancel-btn').show();

    setStatus('Loading zip library...');
    const ok = await loadJSZip();
    if (!ok) {
        toastr.error('Failed to load JSZip library.');
        resetUI();
        return;
    }

    const zip = new JSZip();
    const total = characters.length;
    let exported = 0;
    let failed = 0;
    const usedNames = new Set();
    const errors = [];

    for (let i = 0; i < total; i++) {
        if (abortExport) {
            toastr.warning(`Export cancelled. ${exported} of ${total} exported before cancel.`);
            break;
        }

        const char = characters[i];
        const avatarUrl = char.avatar;
        const charName = char.name || 'unnamed';

        if (!avatarUrl) {
            errors.push(`${charName}: no avatar`);
            failed++;
            continue;
        }

        const pct = Math.round(((i + 1) / total) * 100);
        setProgress(pct);
        setStatus(`Exporting ${i + 1}/${total}: ${charName}`);

        const blob = await fetchCharacterPng(avatarUrl);

        if (blob) {
            const sanitized = safeName(charName).trim() || 'unnamed';
            const uniqueName = getUniqueName(usedNames, sanitized);
            zip.file(`${uniqueName}.png`, blob);
            exported++;
        } else {
            errors.push(`${charName}: export failed`);
            failed++;
        }

        if (i < total - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    if (abortExport && exported === 0) {
        resetUI();
        return;
    }

    if (exported === 0) {
        toastr.error('No characters were exported successfully. Check console (F12).');
        if (errors.length > 0) console.error(`[${MODULE_NAME}] Errors:`, errors);
        resetUI();
        return;
    }

    if (errors.length > 0) {
        zip.file('_export_errors.txt', errors.join('\n'));
    }

    setStatus('Generating zip file...');
    const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (metadata) => {
            setProgress(Math.round(metadata.percent));
        }
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
    downloadBlob(zipBlob, `all_characters_${timestamp}.zip`);

    let msg = `Exported ${exported}/${total} character(s). ZIP size: ${sizeMB} MB.`;
    if (failed > 0) msg += ` ${failed} failed (see _export_errors.txt in ZIP).`;
    toastr.success(msg);

    resetUI();
}

// ─── Import from ZIP ───
async function importFromZip(file) {
    setStatus('Loading zip library...');
    const ok = await loadJSZip();
    if (!ok) {
        toastr.error('Failed to load JSZip library.');
        return;
    }

    try {
        setStatus('Reading ZIP file...');
        const zip = await JSZip.loadAsync(file);
        const pngFiles = Object.keys(zip.files).filter(name => name.endsWith('.png') && !name.startsWith('_'));

        if (pngFiles.length === 0) {
            toastr.warning('No PNG files found in ZIP.');
            setStatus('');
            return;
        }

        setStatus(`Found ${pngFiles.length} character(s). Importing...`);
        let imported = 0;
        let failed = 0;

        for (let i = 0; i < pngFiles.length; i++) {
            const fileName = pngFiles[i];
            const pct = Math.round(((i + 1) / pngFiles.length) * 100);
            setProgress(pct);
            setStatus(`Importing ${i + 1}/${pngFiles.length}: ${fileName}`);

            try {
                const blob = await zip.files[fileName].async('blob');
                const formData = new FormData();
                formData.append('avatar', blob, fileName);

                const response = await fetch('/api/characters/import', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: formData,
                });

                if (response.ok) {
                    imported++;
                } else {
                    failed++;
                    console.warn(`[${MODULE_NAME}] Failed to import ${fileName}: ${response.status}`);
                }
            } catch (e) {
                failed++;
                console.error(`[${MODULE_NAME}] Error importing ${fileName}:`, e);
            }

            await new Promise(r => setTimeout(r, 100));
        }

        setProgress(0);
        $('#export-cards-progress-bar').hide();
        setStatus('');

        toastr.success(`Imported ${imported}/${pngFiles.length} character(s).${failed > 0 ? ` ${failed} failed.` : ''}`);

        // Reload character list
        if (typeof SillyTavern.getContext().getCharacters === 'function') {
            await SillyTavern.getContext().getCharacters();
        }
    } catch (e) {
        console.error(`[${MODULE_NAME}] Import error:`, e);
        toastr.error('Failed to import ZIP file.');
        setStatus('');
    }
}

// ─── UI ───
function createUI() {
    const tags = getAllTags();
    const tagsHtml = tags.length > 0
        ? tags.map(tag => `
            <label style="display:block;margin:3px 0;">
                <input type="checkbox" value="${tag}" style="margin-right:5px;">
                ${tag}
            </label>
        `).join('')
        : '<p style="color:#888;font-size:0.9em;">No tags found</p>';

    const html = `
        <div id="export-cards-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Export All Cards ZIP</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div id="export-tags-filter" style="margin-bottom:10px;">
                        <div style="font-weight:bold;margin-bottom:5px;">Filter by tags:</div>
                        <div style="max-height:150px;overflow-y:auto;padding:5px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;">
                            ${tagsHtml}
                        </div>
                    </div>
                    <div id="export-cards-btn" class="menu_button">
                        <i class="fa-solid fa-box-archive"></i>
                        <span>Export as ZIP</span>
                    </div>
                    <div id="export-cards-cancel-btn" class="menu_button" style="display:none;">
                        <i class="fa-solid fa-xmark"></i>
                        <span>Cancel Export</span>
                    </div>
                    <div id="export-cards-dropzone" style="margin-top:10px;padding:20px;border:2px dashed var(--SmartThemeBorderColor);border-radius:8px;text-align:center;cursor:pointer;transition:all 0.2s;">
                        <i class="fa-solid fa-upload" style="font-size:2em;margin-bottom:10px;display:block;"></i>
                        <div>Drop ZIP here or click to import</div>
                        <input type="file" id="export-cards-file-input" accept=".zip" style="display:none;">
                    </div>
                    <div id="export-cards-progress-bar">
                        <div id="export-cards-progress-fill"></div>
                    </div>
                    <div id="export_cards_status" class="export-cards-status"></div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(html);

    $('#export-cards-btn').on('click', async () => {
        await exportAllAsZip();
    });

    $('#export-cards-cancel-btn').on('click', () => {
        abortExport = true;
        $('#export-cards-cancel-btn').hide();
        setStatus('Cancelling...');
    });

    // Drag & drop
    const dropzone = $('#export-cards-dropzone');
    const fileInput = $('#export-cards-file-input');

    dropzone.on('click', () => fileInput.click());

    dropzone.on('dragover', (e) => {
        e.preventDefault();
        dropzone.css('border-color', 'var(--SmartThemeQuoteColor)');
        dropzone.css('background', 'rgba(92, 184, 92, 0.1)');
    });

    dropzone.on('dragleave', () => {
        dropzone.css('border-color', 'var(--SmartThemeBorderColor)');
        dropzone.css('background', '');
    });

    dropzone.on('drop', async (e) => {
        e.preventDefault();
        dropzone.css('border-color', 'var(--SmartThemeBorderColor)');
        dropzone.css('background', '');

        const files = e.originalEvent.dataTransfer.files;
        if (files.length > 0 && files[0].name.endsWith('.zip')) {
            await importFromZip(files[0]);
        } else {
            toastr.warning('Please drop a ZIP file.');
        }
    });

    fileInput.on('change', async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            await importFromZip(files[0]);
            fileInput.val('');
        }
    });
}

createUI();
console.log(`[${MODULE_NAME}] Extension loaded.`);
