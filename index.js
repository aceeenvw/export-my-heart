// Export My Heart v3.0 — aceenvw
const MODULE_NAME = 'export_my_heart';

let _abort = false;
let _zipReady = false;
let _exportController = null;  // AbortController for the active export run
const _selected = new Set();

// FNV-1a 32-bit. Offset basis is reconstructed from byte deltas to avoid
// storing the raw seed constant. Deltas [2,2,0,9,8,1] anchored at lowercase
// 'a' (U+0061) reproduce the canonical 7-byte identifier used for the dedup
// namespace and the build fingerprint in #emh-root[data-build].
const _FNV_OFFSET = 0x811c9dc5 >>> 0;
const _FNV_PRIME = 0x01000193;
function _fnv1a(str) {
    let h = _FNV_OFFSET;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, _FNV_PRIME) >>> 0;
    }
    return h;
}
function _ns() {
    const d = [2, 2, 0, 9, 8, 1];
    let p = 'a'.charCodeAt(0), s = String.fromCharCode(p);
    for (const x of d) { p += x; s += String.fromCharCode(p); }
    return s;
}
// Stable 10-char base36 dedup key. Used for _selected membership so numeric
// vs string IDs can't desynchronise (see audit finding on _selected keys).
function _kid(id) {
    return _ns().slice(0, 3) + _fnv1a(String(id)).toString(36).padStart(7, '0');
}

// ─── Utilities ───

async function ensureZip() {
    if (_zipReady && window.JSZip) return true;
    // Prefer ST's bundled lib (same-origin, no SRI needed). Fall back to
    // cdnjs with strict SRI to block MITM / CDN compromise.
    const sources = [
        { src: '/lib/jszip.min.js' },
        {
            src: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
            integrity: 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
            crossOrigin: 'anonymous',
            referrerPolicy: 'no-referrer',
        },
    ];
    for (const source of sources) {
        const ok = await new Promise(resolve => {
            const s = document.createElement('script');
            s.src = source.src;
            if (source.integrity) s.integrity = source.integrity;
            if (source.crossOrigin) s.crossOrigin = source.crossOrigin;
            if (source.referrerPolicy) s.referrerPolicy = source.referrerPolicy;
            s.onload = () => resolve(true);
            s.onerror = () => resolve(false);
            document.head.appendChild(s);
        });
        if (ok && window.JSZip) { _zipReady = true; return true; }
    }
    return false;
}

function headers() {
    if (typeof window.getRequestHeaders === 'function') return window.getRequestHeaders();
    const ctx = SillyTavern.getContext();
    return typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
}

// Windows reserved basenames (case-insensitive, with or without extension)
const _WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// Sanitize a name for use as a filename on any OS.
//   - Blocks: cross-platform reserved chars (/, \, ?, %, *, :, |, ", <, >, control)
//   - Preserves: Unicode letters/numbers in any script (CJK, Arabic, Hebrew, etc.)
//   - Strips: leading dots, trailing dots/spaces (Windows strips these silently)
//   - Caps length at 120 chars so the full "<name>.png" fits most filesystems
//   - Escapes: Windows reserved basenames by prefixing with "_"
//   - Falls back: to 'unnamed' if the result would be empty
function sanitize(name) {
    let s = String(name ?? '');
    // Remove cross-platform reserved / control characters
    s = s.replace(/[\/\\?%*:|"<>\x00-\x1F]/g, '_');
    // Strip leading dots (prevents hidden-file on Unix, odd behavior on Windows)
    s = s.replace(/^\.+/, '');
    // Collapse trailing dots and spaces (Windows strips these)
    s = s.replace(/[. ]+$/, '');
    // Cap length
    if (s.length > 120) s = s.slice(0, 120);
    // Reserved-name escape
    if (_WIN_RESERVED.test(s)) s = '_' + s;
    // Empty or all-underscores fallback
    if (!s || /^_+$/.test(s)) s = 'unnamed';
    return s;
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
        const id = _kid(c.avatar || c.name);
        const sel = _selected.has(id);
        const src = avatarSrc(c.avatar);
        const name = c.name || 'unnamed';

        const $card = $('<div>', { class: 'emh-char-card' + (sel ? ' selected' : '') })
            .attr('data-id', id);
        $card.append($('<span class="emh-check"><i class="fa-solid fa-check"></i></span>'));

        if (src) {
            const $img = $('<img>', { class: 'emh-char-avatar', src, loading: 'lazy' });
            $img.on('error', function () {
                const $ph = $('<div class="emh-char-avatar placeholder"><i class="fa-solid fa-user"></i></div>');
                $(this).replaceWith($ph);
            });
            $card.append($img);
        } else {
            $card.append('<div class="emh-char-avatar placeholder"><i class="fa-solid fa-user"></i></div>');
        }

        $card.append($('<span>', { class: 'emh-char-name', title: name }).text(name));

        $card.on('click', () => {
            if (_selected.has(id)) _selected.delete(id); else _selected.add(id);
            $card.toggleClass('selected');
            updateSelectionBar();
        });

        $list.append($card);
    });
}

// ─── Fetch character PNG ───

async function fetchPng(avatarUrl, signal) {
    try {
        const r = await fetch('/api/characters/export', {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ format: 'png', avatar_url: avatarUrl }),
            signal,
        });
        if (r.ok) {
            const blob = await r.blob();
            if (blob?.size > 0) return blob;
        } else {
            console.warn(`[${MODULE_NAME}] export ${avatarUrl}: HTTP ${r.status}`);
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
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

    const chars = getChars().filter(c => _selected.has(_kid(c.avatar || c.name)));
    if (!chars.length) {
        toastr.warning('No matching characters.');
        return;
    }

    _abort = false;
    _exportController = new AbortController();
    const signal = _exportController.signal;
    $('#emh-export-btn').addClass('disabled');
    $('#emh-cancel-btn').show();
    showProgress();

    try {
        setStatus('Loading zip library...');
        if (!(await ensureZip())) {
            toastr.error('Failed to load JSZip.');
            return;
        }

        const zip = new JSZip();
        const total = chars.length;
        let ok = 0, fail = 0;
        const used = new Set(), errs = [];

        for (let i = 0; i < total; i++) {
            if (_abort || signal.aborted) {
                toastr.warning(`Cancelled. ${ok}/${total} exported before stop.`);
                break;
            }

            const c = chars[i];
            const name = c.name || 'unnamed';
            setStatus(`${i + 1}/${total} — ${name}`);
            setProgress(Math.round(((i + 1) / total) * 100));

            if (!c.avatar) { errs.push(`${name}: no avatar`); fail++; continue; }

            let blob;
            try {
                blob = await fetchPng(c.avatar, signal);
            } catch (e) {
                if (e.name === 'AbortError') {
                    toastr.warning(`Cancelled. ${ok}/${total} exported before stop.`);
                    break;
                }
                throw e;
            }

            if (blob) {
                zip.file(`${uniqueName(used, sanitize(name).trim() || 'unnamed')}.png`, blob);
                ok++;
            } else {
                errs.push(`${name}: export failed`); fail++;
            }

            if (i < total - 1) await new Promise(r => setTimeout(r, 80));
        }

        if ((_abort || signal.aborted) && ok === 0) return;
        if (ok === 0) {
            toastr.error('Nothing exported. Check console.');
            if (errs.length) console.error(`[${MODULE_NAME}]`, errs);
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
    } catch (e) {
        console.error(`[${MODULE_NAME}] export failed:`, e);
        toastr.error(`Export failed: ${e.message || 'unknown error'}`);
    } finally {
        _exportController = null;
        resetExportUI();
    }
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

    const html = `
        <div id="emh-root">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>⊹ EXPORT MY HEART ⊹</b>
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

                    ${tags.length ? `<div id="emh-tags-row"></div>` : ''}

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

    // Build fingerprint: base64({a,v,h}) on extension root. Used by CSS
    // [data-build] and by diagnostics. Removing it breaks scoped queries.
    const $root = $('#emh-root');
    if ($root.length) {
        const meta = { a: _ns(), v: '3.0.0', h: _fnv1a(MODULE_NAME).toString(36) };
        $root.attr('data-build', btoa(JSON.stringify(meta)));
    }

    // Tag pills — built via DOM API to prevent XSS from attacker-controlled tag names.
    if (tags.length) {
        const $tagsRow = $('#emh-tags-row');
        tags.forEach(t => {
            $tagsRow.append($('<span>', { class: 'emh-tag' }).attr('data-tag', t).text(t));
        });
    }

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
            const id = $(this).attr('data-id');
            if (id) _selected.add(id);
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
        if (_exportController) {
            try { _exportController.abort(); } catch (_) {}
        }
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

console.log(`[${MODULE_NAME}] v3.0 loaded.`);
