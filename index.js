// Export All Cards ZIP v1.0 — by aceenvw
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
    const el = document.getElementById('export_cards_status');
    if (el) el.textContent = text;
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

    const endpoints = [
        { url: '/api/characters/export', body: { format: 'png', avatar_url: avatarUrl } },
    ];

    for (const ep of endpoints) {
        try {
            const r = await fetch(ep.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(ep.body),
            });
            if (r.ok) {
                const blob = await r.blob();
                if (blob && blob.size > 0) return blob;
            } else {
                console.warn(`[${MODULE_NAME}] ${ep.url} → ${r.status}`);
            }
        } catch (e) {
            console.warn(`[${MODULE_NAME}] ${ep.url} failed:`, e);
        }
    }

    return null;
}

// ─── Main export function ───

async function exportAllAsZip() {
    const ctx = SillyTavern.getContext();
    const characters = ctx.characters;

    if (!characters || characters.length === 0) {
        toastr.warning('No characters found.');
        return;
    }

    const confirmed = confirm(`Export ${characters.length} character(s) as PNG into a ZIP file?\n\nThis may take a while for large collections.`);
    if (!confirmed) return;

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

// ─── UI ───

function createUI() {
    const html = `
        <div id="export-cards-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Export All Cards ZIP</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div id="export-cards-btn" class="menu_button">
                        <i class="fa-solid fa-box-archive"></i>
                        <span>Export All as ZIP</span>
                    </div>
                    <div id="export-cards-cancel-btn" class="menu_button" style="display:none;">
                        <i class="fa-solid fa-xmark"></i>
                        <span>Cancel Export</span>
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
}

createUI();
console.log(`[${MODULE_NAME}] Extension loaded.`);
