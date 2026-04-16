// Export My Heart v3.0 — aceenvw
const MODULE_NAME = 'export_my_heart';

let _abort = false;
let _zipReady = false;
const _selected = new Set();

// ─── Utilities ───

async function ensureZip() {
    if (_zipReady && window.JSZip) return true;
    return new Promise(ok => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => { _zipReady = true; ok(true); };
        s.onerror = () => ok(false);
        document.head.appendChild(s);
    });
}

function headers() {
    if (typeof window.getRequestHeaders === 'function') return window.getRequestHeaders();
    const ctx = SillyTavern.getContext();
    return typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
}

function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_\-\u0400-\u04FF ().]/g, '_');
}

function uniqueName(used, base) {
    let n = base, c = 2;
    while (used.has(n)) n = `${base} (${c++})`;
    used.add(n);
    return n;
}

function downloadBlob(blob, name) {
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: name
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
}

function avatarSrc(avatar) {
    if (!avatar) return null;
    return `/characters/${encodeURIComponent(avatar)}`;
}

// ─── State ───

function getChars() {
    return SillyTavern.getContext().characters || [];
}

function getTags() {
    const tags = new Set();
    getChars().forEach(c => {
        if (Array.isArray(c.tags)) c.tags.forEach(t => tags.add(t));
    });
    return [...tags].sort();
}

// ─── UI helpers ───

function setStatus(txt) { $('#emh-status').text(txt); }
function setProgress(pct) { $('#emh-progress-fill').css('width', `${pct}%`); }

function showProgress() { $('#emh-progress').addClass('active'); }
function hideProgress() {
    $('#emh-progress').removeClass('active');
    setProgress(0);
    setStatus('');
}

function updateSelectionBar() {
    const total = getChars().length;
    const count = _selected.size;
    $('#emh-sel-count').text(count > 0 ? `${count} / ${total} selected` : `${total} characters`);
    $('#emh-export-btn').toggleClass('disabled', count === 0);
}

// ─── Render character grid ───

function renderGrid(filter = '', activeTags = []) {
    const $list = $('#emh-char-list');
    $list.empty();

    let chars = getChars();
    if (!chars.length) {
        $list.append('<div class="emh-empty"><i class="fa-solid fa-ghost"></i><br>No characters found</div>');
        return;
    }

    const q = filter.toLowerCase().trim();
    if (q) chars = chars.filter(c => (c.name || '').toLowerCase().includes(q));
    if (activeTags.length > 0) {
        chars = chars.filter(c =>
            Array.isArray(c.tags) && activeTags.some(t => c.tags.includes(t))
        );
    }

    if (!chars.length) {
        $list.append('<div class="emh-empty">No matches</div>');
        return;
    }

    chars.forEach(c => {
        const id = c.avatar || c.name;
        const sel = _selected.has(id);
        const src = avatarSrc(c.avatar);

        const $card = $(`
            <div class="emh-char-card${sel ? ' selected' : ''}" data-id="${id}">
                <span class="emh-check"><i class="fa-solid fa-check"></i></span>
                ${src
                    ? `<img class="emh-char-avatar" src="${src}" loading="lazy" onerror="this.outerHTML='<div class=\\'emh-char-avatar placeholder\\'><i class=\\'fa-solid fa-user\\'></i></div>'">`
                    : '<div class="emh-char-avatar placeholder"><i class="fa-solid fa-user"></i></div>'
                }
                <span class="emh-char-name" title="${(c.name || 'unnamed').replace(/"/g, '&quot;')}">${c.name || 'unnamed'}</span>
            </div>
        `);

        $card.on('click', () => {
            if (_selected.has(id)) _selected.delete(id); else _selected.add(id);
            $card.toggleClass('selected');
            updateSelectionBar();
        });

        $list.append($card);
    });
}

// ─── Fetch character PNG ───

async function fetchPng(avatarUrl) {
    try {
        const r = await fetch('/api/characters/export', {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ format: 'png', avatar_url: avatarUrl }),
        });
        if (r.ok) {
            const blob = await r.blob();
            if (blob?.size > 0) return blob;
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}]`, e);
    }
    return null;
}

// ─── Export ───

async function runExport() {
    if (_selected.size === 0) {
        toastr.warning('Select at least one character.');
        return;
    }

    const chars = getChars().filter(c => _selected.has(c.avatar || c.name));
    if (!chars.length) {
        toastr.warning('No matching characters.');
        return;
    }

    _abort = false;
    $('#emh-export-btn').addClass('disabled');
    $('#emh-cancel-btn').show();
    showProgress();

    setStatus('Loading zip library...');
    if (!(await ensureZip())) {
        toastr.error('Failed to load JSZip.');
        resetExportUI();
        return;
    }

    const zip = new JSZip();
    const total = chars.length;
    let ok = 0, fail = 0;
    const used = new Set(), errs = [];

    for (let i = 0; i < total; i++) {
        if (_abort) {
            toastr.warning(`Cancelled. ${ok}/${total} exported before stop.`);
            break;
        }

        const c = chars[i];
        const name = c.name || 'unnamed';
        setStatus(`${i + 1}/${total} — ${name}`);
        setProgress(Math.round(((i + 1) / total) * 100));

        if (!c.avatar) { errs.push(`${name}: no avatar`); fail++; continue; }

        const blob = await fetchPng(c.avatar);
        if (blob) {
            zip.file(`${uniqueName(used, sanitize(name).trim() || 'unnamed')}.png`, blob);
            ok++;
        } else {
            errs.push(`${name}: export failed`); fail++;
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 80));
    }

    if (_abort && ok === 0) { resetExportUI(); return; }
    if (ok === 0) {
        toastr.error('Nothing exported. Check console.');
        if (errs.length) console.error(`[${MODULE_NAME}]`, errs);
        resetExportUI();
        return;
    }

    if (errs.length) zip.file('_errors.txt', errs.join('\n'));

    setStatus('Packing zip...');
    const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        m => setProgress(Math.round(m.percent))
    );

    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const mb = (zipBlob.size / 1048576).toFixed(1);
    downloadBlob(zipBlob, `characters_${ts}.zip`);

    let msg = `Exported ${ok}/${total}. ZIP: ${mb} MB.`;
    if (fail > 0) msg += ` ${fail} failed (see _errors.txt).`;
    toastr.success(msg);

    resetExportUI();
}

function resetExportUI() {
    $('#emh-export-btn').removeClass('disabled');
    $('#emh-cancel-btn').hide();
    hideProgress();
}

// ─── Import ───

async function importSingleFile(file) {
    const fd = new FormData();
    fd.append('avatar', file, file.name);

    const hdrs = headers();
    delete hdrs['Content-Type'];

    const r = await fetch('/api/characters/import', { method: 'POST', headers: hdrs, body: fd });
    return r.ok;
}

async function importFiles(files) {
    const valid = [...files].filter(f => {
        const n = f.name.toLowerCase();
        return n.endsWith('.png') || n.endsWith('.json');
    });

    if (!valid.length) {
        toastr.warning('Drop .png or .json character files.');
        return;
    }

    showProgress();
    const total = valid.length;
    let ok = 0, fail = 0;

    for (let i = 0; i < total; i++) {
        setProgress(Math.round(((i + 1) / total) * 100));
        setStatus(`${i + 1}/${total} — ${valid[i].name}`);
        try {
            (await importSingleFile(valid[i])) ? ok++ : fail++;
        } catch { fail++; }
        if (i < total - 1) await new Promise(r => setTimeout(r, 80));
    }

    hideProgress();

    if (ok > 0) {
        toastr.success(`Imported ${ok}/${total}.${fail ? ` ${fail} failed.` : ''}`);
        if (typeof SillyTavern.getContext().getCharacters === 'function') {
            await SillyTavern.getContext().getCharacters();
        }
        renderGrid();
        updateSelectionBar();
    } else {
        toastr.error('No characters were imported.');
    }
}

// ─── Build UI ───

function buildUI() {
    const tags = getTags();

    const tagsHtml = tags.map(t =>
        `<span class="emh-tag" data-tag="${t.replace(/"/g, '&quot;')}">${t}</span>`
    ).join('');

    const html = `
        <div id="emh-root">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Export My Heart</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <!-- Toolbar -->
                    <div id="emh-toolbar">
                        <input id="emh-search" type="text" placeholder="Search characters..." autocomplete="off">
                        <button class="emh-btn" id="emh-select-all-btn" title="Select all visible">
                            <i class="fa-solid fa-check-double"></i>
                        </button>
                        <button class="emh-btn" id="emh-deselect-btn" title="Deselect all">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    ${tags.length ? `<div id="emh-tags-row">${tagsHtml}</div>` : ''}

                    <!-- Character grid -->
                    <div id="emh-char-list"></div>

                    <!-- Selection bar + export -->
                    <div id="emh-selection-bar">
                        <span class="emh-sel-count" id="emh-sel-count">0 characters</span>
                        <span class="emh-sel-actions">
                            <button class="emh-btn primary disabled" id="emh-export-btn">
                                <i class="fa-solid fa-box-archive"></i> Export
                            </button>
                            <button class="emh-btn danger" id="emh-cancel-btn" style="display:none;">
                                <i class="fa-solid fa-stop"></i> Cancel
                            </button>
                        </span>
                    </div>

                    <!-- Progress -->
                    <div id="emh-progress">
                        <div id="emh-progress-track"><div id="emh-progress-fill"></div></div>
                        <span id="emh-status"></span>
                    </div>

                    <!-- Drop zone -->
                    <div id="emh-dropzone">
                        <i class="fa-solid fa-file-import"></i>
                        <span>Drop or click to import (.png, .json)</span>
                    </div>
                    <input type="file" id="emh-file-input" accept=".png,.json" multiple style="display:none;">
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(html);

    // Render initial grid
    renderGrid();
    updateSelectionBar();

    // ── Events ──

    let searchTimer;
    const getActiveTags = () => {
        const t = [];
        $('.emh-tag.active').each(function() { t.push($(this).data('tag')); });
        return t;
    };
    const refresh = () => renderGrid($('#emh-search').val(), getActiveTags());

    // Search
    $('#emh-search').on('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(refresh, 180);
    });

    // Tags
    $(document).on('click', '.emh-tag', function() {
        $(this).toggleClass('active');
        refresh();
    });

    // Select all visible
    $('#emh-select-all-btn').on('click', () => {
        $('#emh-char-list .emh-char-card').each(function() {
            const id = $(this).data('id');
            _selected.add(String(id));
            $(this).addClass('selected');
        });
        updateSelectionBar();
    });

    // Deselect
    $('#emh-deselect-btn').on('click', () => {
        _selected.clear();
        $('.emh-char-card').removeClass('selected');
        updateSelectionBar();
    });

    // Export
    $('#emh-export-btn').on('click', () => runExport());

    // Cancel
    $('#emh-cancel-btn').on('click', () => {
        _abort = true;
        setStatus('Cancelling...');
        $('#emh-cancel-btn').hide();
    });

    // Drop zone — input is outside dropzone to avoid click propagation issues
    const $dz = $('#emh-dropzone');
    const $fi = $('#emh-file-input');

    $dz.on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        $fi[0].click();
    });
    $dz.on('dragover', e => { e.preventDefault(); $dz.addClass('dragover'); });
    $dz.on('dragleave', () => $dz.removeClass('dragover'));
    $dz.on('drop', async e => {
        e.preventDefault();
        $dz.removeClass('dragover');
        const f = e.originalEvent.dataTransfer.files;
        if (f.length) await importFiles(f);
    });
    $fi.on('change', async e => {
        if (e.target.files.length) { await importFiles(e.target.files); $fi.val(''); }
    });
}

// ─── Init ───

buildUI();

// Deferred first render: characters may not be loaded yet at script init time.
// Poll briefly, then also re-render whenever the drawer is opened.
(function deferredLoad() {
    let attempts = 0;
    const tryRender = () => {
        const chars = getChars();
        if (chars.length > 0 || attempts >= 30) {
            renderGrid();
            updateSelectionBar();
            return;
        }
        attempts++;
        setTimeout(tryRender, 300);
    };
    tryRender();

    // Also refresh grid whenever the user opens the drawer
    $(document).on('click', '#emh-root .inline-drawer-toggle', () => {
        setTimeout(() => {
            renderGrid($('#emh-search').val(),
                (() => { const t = []; $('.emh-tag.active').each(function() { t.push($(this).data('tag')); }); return t; })()
            );
            updateSelectionBar();
        }, 50);
    });
})();

// runtime integrity
(function(){const _m=[101,120,112,111,114,116,95,109,121,95,104,101,97,114,116];const _k=[97,99,101,101,110,118,119];const _c=s=>s.map(c=>String.fromCharCode(c)).join('');if(MODULE_NAME===_c(_m)){Object.defineProperty(window,'__emh_rt',{value:_c(_k),configurable:false})}})();

console.log(`[${MODULE_NAME}] v3.0 loaded.`);
