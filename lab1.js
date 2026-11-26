const LAB1_STATE_KEY = 'agc_gpu_lab1_state_48h';
const FULL_CHAT_ARCHIVE_KEY = 'agc_full_chat_history_48h';
const ACTIVE_SESSION_KEY = 'agc_active_session_id';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const AUTO_RETRY_SECONDS = 10;

const GPU_ENDPOINT_STORAGE_KEY = 'agc_gpu_render_url';
const GPU_API_KEY_STORAGE_KEY = 'apiKey';
const GPU_META_STORAGE_KEY = 'agc_gpu_endpoint_meta_v1';

const DEFAULT_AICREDITS_IMAGE_ENDPOINT = 'https://api.aicredits.in/v1/images/generations';
const DEFAULT_AICREDITS_IMAGE_MODEL = 'black-forest-labs/flux-1-schnell';

const retryTimers = new Map();
let activeGpuPopupPromise = null;

function sanitizeEndpointUrl(rawVal = '') {
    const trimmed = (rawVal || '').trim();
    const match = trimmed.match(/https?:\/\/[^\s"'\\\]\)]+/i);
    return (match ? match[0] : trimmed).replace(/\/+$/, '');
}

function getActiveOrLatestSessionId() {
    try {
        const explicitId = localStorage.getItem(ACTIVE_SESSION_KEY);
        if (explicitId) {
            return explicitId;
        }
    } catch (_) {}

    try {
        const raw = localStorage.getItem(FULL_CHAT_ARCHIVE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const now = Date.now();
        const validSessions = Object.values(parsed)
            .filter((s) => s && s.sessionId && s.updatedAt && (now - s.updatedAt) <= FORTY_EIGHT_HOURS_MS)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return validSessions.length ? validSessions[0].sessionId : 'default_gpu_session';
    } catch (_) {
        return 'default_gpu_session';
    }
}

function loadLabStateMap() {
    try {
        const raw = localStorage.getItem(LAB1_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const now = Date.now();
        const cleaned = {};

        Object.keys(parsed).forEach((sessionKey) => {
            const entry = parsed[sessionKey];
            if (entry && entry.updatedAt && (now - entry.updatedAt) <= FORTY_EIGHT_HOURS_MS) {
                cleaned[sessionKey] = entry;
            }
        });

        localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(cleaned));
        return cleaned;
    } catch (_) {
        return {};
    }
}

function loadLabDataForSession(currentSessionId) {
    const map = loadLabStateMap();
    if (map[currentSessionId] && map[currentSessionId].data) {
        return map[currentSessionId].data;
    }
    return { characters: [], photos: [], scenes: [] };
}

const sessionId = getActiveOrLatestSessionId();
let labData = loadLabDataForSession(sessionId);
if (!Array.isArray(labData.characters)) labData.characters = [];
if (!Array.isArray(labData.photos)) labData.photos = [];
if (!Array.isArray(labData.scenes)) labData.scenes = [];

function persistLabData() {
    try {
        const map = loadLabStateMap();
        map[sessionId] = {
            sessionId,
            updatedAt: Date.now(),
            data: labData
        };
        localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(map));
    } catch (_) {
        try {
            const lightweightData = {
                characters: labData.characters.map(({ imageUrl, ...rest }) => rest),
                photos: labData.photos.map(({ imageUrl, ...rest }) => rest),
                scenes: labData.scenes.map(({ imageUrl, ...rest }) => rest)
            };
            const map = loadLabStateMap();
            map[sessionId] = {
                sessionId,
                updatedAt: Date.now(),
                data: lightweightData
            };
            localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(map));
        } catch (_) {}
    }
}

function clearRetryTimer(rowId) {
    if (retryTimers.has(rowId)) {
        clearInterval(retryTimers.get(rowId));
        retryTimers.delete(rowId);
    }
}

// =========================================================
// PRESS & HOLD ZOOM POPUP (SHOW WHILE HELD, CLOSE ON RELEASE)
// =========================================================

function ensureHoldZoomPopup() {
    let modal = document.getElementById('zoomModalOverlay');
    let modalImg = document.getElementById('zoomModalImage');
    let modalTitle = document.getElementById('zoomModalTitle');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'zoomModalOverlay';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(2, 6, 23, 0.92);
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            padding: 16px;
            box-sizing: border-box;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        `;

        modalTitle = document.createElement('div');
        modalTitle.id = 'zoomModalTitle';
        modalTitle.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: #e2e8f0;
            margin-bottom: 10px;
            text-align: center;
        `;

        modalImg = document.createElement('img');
        modalImg.id = 'zoomModalImage';
        modalImg.alt = 'Hold Zoom Preview';
        modalImg.style.cssText = `
            max-width: 96vw;
            max-height: 82vh;
            width: auto;
            height: auto;
            object-fit: contain;
            border-radius: 12px;
            border: 1px solid #334155;
            background: #0f172a;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75);
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            pointer-events: none;
        `;

        modal.appendChild(modalTitle);
        modal.appendChild(modalImg);
        document.body.appendChild(modal);
    }

    return { modal, modalImg, modalTitle };
}

function openZoomModal(imgSrc, labelText = 'Reference Photo') {
    if (!imgSrc) return;
    const { modal, modalImg, modalTitle } = ensureHoldZoomPopup();
    if (!modal || !modalImg) return;
    if (modalTitle) {
        modalTitle.textContent = labelText || 'Reference Photo';
    }
    modalImg.src = imgSrc;
    modal.style.display = 'flex';
}

function hideHoldZoomPopup() {
    const modal = document.getElementById('zoomModalOverlay');
    const modalImg = document.getElementById('zoomModalImage');
    if (modal) {
        modal.style.display = 'none';
    }
    if (modalImg) {
        modalImg.src = '';
    }
}

window.addEventListener('pointerup', hideHoldZoomPopup);
window.addEventListener('pointercancel', hideHoldZoomPopup);
window.addEventListener('touchend', hideHoldZoomPopup);
window.addEventListener('touchcancel', hideHoldZoomPopup);
window.addEventListener('mouseup', hideHoldZoomPopup);
window.addEventListener('blur', hideHoldZoomPopup);

function attachPressAndHoldZoom(imgEl, getSrcFn, getLabelFn = null) {
    if (!imgEl) return;

    imgEl.style.cursor = 'pointer';
    imgEl.style.userSelect = 'none';
    imgEl.style.webkitUserSelect = 'none';
    imgEl.style.webkitTouchCallout = 'none';

    const startZoom = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const src = typeof getSrcFn === 'function' ? getSrcFn() : '';
        if (!src) return;
        e.preventDefault();
        e.stopPropagation();
        const label = typeof getLabelFn === 'function' ? getLabelFn() : 'Reference Photo';
        openZoomModal(src, label);
    };

    const endZoom = () => {
        hideHoldZoomPopup();
    };

    imgEl.addEventListener('pointerdown', startZoom);
    imgEl.addEventListener('pointerup', endZoom);
    imgEl.addEventListener('pointercancel', endZoom);
    imgEl.addEventListener('pointerleave', endZoom);
    imgEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// =========================================================
// ONE-TIME GPU CONNECTION CONFIG & POPUP (API KEY OPTIONAL)
// =========================================================

function getSavedGpuEndpoint() {
    const raw = (
        localStorage.getItem(GPU_ENDPOINT_STORAGE_KEY) ||
        localStorage.getItem('baseUrl') ||
        ''
    ).trim();
    return sanitizeEndpointUrl(raw);
}

function getSavedGpuMeta() {
    try {
        const raw = localStorage.getItem(GPU_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { model: DEFAULT_AICREDITS_IMAGE_MODEL, note: '' };
    } catch (_) {
        return { model: DEFAULT_AICREDITS_IMAGE_MODEL, note: '' };
    }
}

function saveGpuConnectionSettings({ endpointUrl, apiKey = '', model = '', note = '' }) {
    const cleanUrl = sanitizeEndpointUrl(endpointUrl);
    const cleanKey = (apiKey || '').trim();
    const cleanModel = (model || '').trim();
    const cleanNote = (note || '').trim();

    localStorage.setItem(GPU_ENDPOINT_STORAGE_KEY, cleanUrl);
    if (cleanKey) {
        localStorage.setItem(GPU_API_KEY_STORAGE_KEY, cleanKey);
    } else {
        localStorage.removeItem(GPU_API_KEY_STORAGE_KEY);
    }

    localStorage.setItem(
        GPU_META_STORAGE_KEY,
        JSON.stringify({ model: cleanModel, note: cleanNote })
    );

    return {
        endpointUrl: cleanUrl,
        apiKey: cleanKey,
        model: cleanModel,
        note: cleanNote
    };
}

function openGpuConnectPopup(forceOpen = true) {
    if (activeGpuPopupPromise) {
        return activeGpuPopupPromise;
    }

    activeGpuPopupPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById('agcOneTimeGpuModal');
        if (existing) existing.remove();

        const currentEndpoint = getSavedGpuEndpoint() || DEFAULT_AICREDITS_IMAGE_ENDPOINT;
        const currentKey = localStorage.getItem(GPU_API_KEY_STORAGE_KEY) || '';
        const currentMeta = getSavedGpuMeta();

        if (!forceOpen && getSavedGpuEndpoint()) {
            activeGpuPopupPromise = null;
            resolve({
                endpointUrl: getSavedGpuEndpoint(),
                apiKey: currentKey,
                model: currentMeta.model || DEFAULT_AICREDITS_IMAGE_MODEL,
                note: currentMeta.note || ''
            });
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'agcOneTimeGpuModal';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(2, 6, 23, 0.78);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            padding: 16px;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        overlay.innerHTML = `
            <div style="
                width: 100%;
                max-width: 420px;
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid #334155;
                border-radius: 14px;
                padding: 20px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
            ">
                <div style="font-size: 17px; font-weight: 700; margin-bottom: 6px;">
                    GPU LAB Settings (One-Time Setup)
                </div>
                <div style="font-size: 12px; color: #94a3b8; line-height: 1.45; margin-bottom: 14px;">
                    AiCredits Images API URL, API Key aur Model ID daal kar Save & Go dabayein.
                </div>

                <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
                    Images / Render Endpoint URL *
                </label>
                <input
                    id="agcGpuUrlInput"
                    type="text"
                    value="${currentEndpoint}"
                    placeholder="https://api.aicredits.in/v1/images/generations"
                    style="
                        width: 100%;
                        box-sizing: border-box;
                        padding: 10px 12px;
                        margin-bottom: 10px;
                        border-radius: 8px;
                        border: 1px solid #475569;
                        background: #020617;
                        color: #f8fafc;
                        font-size: 13px;
                    "
                />

                <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
                    API Key (AiCredits Key)
                </label>
                <input
                    id="agcGpuKeyInput"
                    type="text"
                    value="${currentKey}"
                    placeholder="sk-..."
                    style="
                        width: 100%;
                        box-sizing: border-box;
                        padding: 10px 12px;
                        margin-bottom: 10px;
                        border-radius: 8px;
                        border: 1px solid #475569;
                        background: #020617;
                        color: #f8fafc;
                        font-size: 13px;
                    "
                />

                <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
                    Model ID
                </label>
                <input
                    id="agcGpuModelInput"
                    type="text"
                    value="${currentMeta.model || DEFAULT_AICREDITS_IMAGE_MODEL}"
                    placeholder="black-forest-labs/flux-1-schnell"
                    style="
                        width: 100%;
                        box-sizing: border-box;
                        padding: 10px 12px;
                        margin-bottom: 10px;
                        border-radius: 8px;
                        border: 1px solid #475569;
                        background: #020617;
                        color: #f8fafc;
                        font-size: 13px;
                    "
                />

                <div
                    id="agcGpuPopupError"
                    style="color: #f87171; font-size: 12px; min-height: 16px; margin-bottom: 10px;"
                ></div>

                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button
                        id="agcGpuCancelBtn"
                        type="button"
                        style="
                            padding: 8px 14px;
                            border-radius: 8px;
                            border: 1px solid #475569;
                            background: transparent;
                            color: #cbd5e1;
                            cursor: pointer;
                            font-size: 13px;
                        "
                    >Cancel</button>
                    <button
                        id="agcGpuSaveBtn"
                        type="button"
                        style="
                            padding: 8px 16px;
                            border-radius: 8px;
                            border: none;
                            background: #2563eb;
                            color: #ffffff;
                            font-weight: 600;
                            cursor: pointer;
                            font-size: 13px;
                        "
                    >Save & Go</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const urlInput = document.getElementById('agcGpuUrlInput');
        const keyInput = document.getElementById('agcGpuKeyInput');
        const modelInput = document.getElementById('agcGpuModelInput');
        const errBox = document.getElementById('agcGpuPopupError');
        const cancelBtn = document.getElementById('agcGpuCancelBtn');
        const saveBtn = document.getElementById('agcGpuSaveBtn');

        const cleanup = () => {
            overlay.remove();
            activeGpuPopupPromise = null;
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            reject(new Error('GPU connection cancelled.'));
        });

        const submitPopup = () => {
            const rawUrl = sanitizeEndpointUrl(urlInput.value || '');
            if (!rawUrl) {
                errBox.textContent = 'Kripya Endpoint URL daalein.';
                return;
            }
            if (!/^https?:\/\//i.test(rawUrl)) {
                errBox.textContent = 'URL http:// ya https:// se shuru hona chahiye.';
                return;
            }

            const saved = saveGpuConnectionSettings({
                endpointUrl: rawUrl,
                apiKey: keyInput.value || '',
                model: (modelInput.value || '').trim() || DEFAULT_AICREDITS_IMAGE_MODEL,
                note: currentMeta.note || ''
            });

            cleanup();
            resolve(saved);
        };

        saveBtn.addEventListener('click', submitPopup);
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitPopup();
            }
        });

        setTimeout(() => urlInput.focus(), 20);
    });

    return activeGpuPopupPromise;
}

function bindGpuLabHeaderTrigger() {
    const candidates = Array.from(
        document.querySelectorAll('button, a, span, div, h1, h2, h3, h4, label')
    );

    const gpuLabEl = candidates.find((el) => {
        if (el.id === 'agcOneTimeGpuModal' || el.closest('#agcOneTimeGpuModal')) return false;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text === '⚡ GPU LAB' || text === 'GPU LAB';
    });

    if (gpuLabEl && !gpuLabEl.dataset.gpuPopupBound) {
        gpuLabEl.dataset.gpuPopupBound = '1';
        gpuLabEl.style.cursor = 'pointer';
        gpuLabEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openGpuConnectPopup(true).catch(() => {});
        });
    }
}

function bindBackNavigationButton() {
    const backCandidates = Array.from(
        document.querySelectorAll('button, a, span, div')
    ).filter((el) => {
        if (el.id === 'agcOneTimeGpuModal' || el.closest('#agcOneTimeGpuModal')) return false;
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const idOrClass = `${el.id || ''} ${el.className || ''}`.toLowerCase();
        return (
            txt === '← dashboard' ||
            txt === 'dashboard' ||
            txt === '← back' ||
            txt === 'back' ||
            idOrClass.includes('back-btn') ||
            idOrClass.includes('backbtn')
        );
    });

    backCandidates.forEach((btn) => {
        if (btn.dataset.agcBackBound === '1') return;
        btn.dataset.agcBackBound = '1';
        btn.style.cursor = 'pointer';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
            } catch (_) {}

            if (window.history.length > 1 && document.referrer) {
                window.history.back();
            } else {
                window.location.assign('dashboard.html');
            }
        });
    });
}

// =========================================================
// CHARACTER DETECTOR FOR MULTI-CHARACTER SCENES
// =========================================================

function extractCharacterKeywords(charItem, index = 0) {
    const rawLabel = (charItem?.label || '')
        .replace(/^स्टेप\s*\d+\s*:\s*/i, '')
        .replace(/^character\s*\d*\s*:\s*/i, '')
        .trim();

    const mainName = rawLabel.split(/[(-]/)[0].trim().toLowerCase();
    const promptLower = (charItem?.prompt || '').toLowerCase();

    const tokens = new Set();
    if (mainName && mainName.length >= 2) {
        tokens.add(mainName);
        mainName.split(/\s+/).forEach((w) => {
            if (w.length >= 2) tokens.add(w);
        });
    }

    const knownAliases = [
        ['aryan', 'आर्यन'],
        ['nobita', 'नोबिता'],
        ['doraemon', 'डोरेमोन'],
        ['shizuka', 'शिजुका'],
        ['gian', 'जियान'],
        ['suneo', 'सुनिओ', 'सुनियो'],
        ['wizard', 'जादूगर'],
        ['sia', 'सिया']
    ];

    knownAliases.forEach((group) => {
        const matchedInChar = group.some(
            (term) => mainName.includes(term.toLowerCase()) || promptLower.includes(term.toLowerCase())
        );
        if (matchedInChar) {
            group.forEach((term) => tokens.add(term.toLowerCase()));
        }
    });

    return {
        index,
        label: rawLabel || `Character ${index + 1}`,
        imageUrl: charItem?.imageUrl || '',
        tokens: Array.from(tokens)
    };
}

function detectCharactersInSceneText(sceneText = '', fallbackIdx = 0) {
    const renderedChars = labData.characters
        .map((c, idx) => extractCharacterKeywords(c, idx))
        .filter((c) => Boolean(c.imageUrl));

    if (!renderedChars.length) {
        return { matched: [], allRendered: [] };
    }

    const haystack = (sceneText || '').toLowerCase();
    const matched = renderedChars.filter((ch) =>
        ch.tokens.some((tok) => tok && haystack.includes(tok))
    );

    if (matched.length > 0) {
        return { matched, allRendered: renderedChars };
    }

    if (renderedChars.length === 1) {
        return { matched: [renderedChars[0]], allRendered: renderedChars };
    }

    const safeIdx = fallbackIdx % renderedChars.length;
    return { matched: [], allRendered: renderedChars, suggestedIdx: safeIdx };
}

function resolveRenderSize(promptText = '', kind = '') {
    if (kind === 'character_reference') {
        return '1344x768';
    }

    const p = (promptText || '').toLowerCase();
    const isYouTubeShorts =
        /\b9\s*:\s*16\b/.test(p) ||
        /\byoutube\s*shorts?\b/.test(p) ||
        /\bshorts?\s*mode\b/.test(p) ||
        /यूट्यूब\s*शॉर्ट्स/.test(promptText || '');

    if (isYouTubeShorts) {
        return '768x1344';
    }

    return '1344x768';
}

function buildDetectedRefContextNote(allRefUrls = [], refImageUrl = '') {
    const list = Array.isArray(allRefUrls) && allRefUrls.length
        ? allRefUrls
        : (refImageUrl ? [refImageUrl] : []);
    if (!list.length) return '';

    const matchedCharNames = labData.characters
        .filter((c) => Boolean(c.imageUrl) && list.includes(c.imageUrl))
        .map((c, idx) => {
            const cleanName = (c.label || `Character ${idx + 1}`)
                .replace(/^स्टेप\s*\d+\s*:\s*/i, '')
                .replace(/^character\s*\d*\s*:\s*/i, '')
                .trim();
            return `${idx + 1}. ${cleanName}`;
        });

    const namesText = matchedCharNames.length ? ` (${matchedCharNames.join(', ')})` : '';
    return ` Attached ${list.length} detected reference sheet(s)${namesText} — place ONLY the detected character(s) into the requested pose, action, and background without mixing unrelated characters.`;
}

function formatPromptForRender(promptText, kind, refImageUrl = '', allRefUrls = []) {
    const clean = (promptText || '').trim();
    const qualityBoost = 'high detail, sharp focus, clean lighting, crisp edges, natural proportions, no blur, no distortion, no watermark';
    const refNote = buildDetectedRefContextNote(allRefUrls, refImageUrl);

    if (kind === 'character_reference') {
        return `${clean} Clean wide horizontal 16:9 character turnaround sheet on a solid light grey studio background, top row showing separated full-body poses (Front, Side Profile, Back, Three-Quarter) spaced apart with no overlapping heads or stacked faces, bottom row showing separate expression faces (Happy, Sad, Angry, Surprised), ${qualityBoost}.`;
    }

    if (kind === 'scene_photo') {
        return `${clean} Widescreen 16:9 YouTube scene frame using the exact locked character appearance from reference while updating pose, action, and background,${refNote} ${qualityBoost}.`;
    }

    return `${clean}${refNote} ${qualityBoost}.`;
}

async function requestSingleGpuRender(endpoint, headers, bodyPayload) {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const apiErrMsg = data?.error?.message || data?.message || '';
        throw new Error(apiErrMsg ? `GPU error (${res.status}): ${apiErrMsg}` : `GPU error (${res.status})`);
    }

    const firstItem = Array.isArray(data.data) ? data.data[0] : null;
    const b64Img = firstItem?.b64_json || data.b64_json || '';
    const outUrl =
        firstItem?.url ||
        (b64Img ? `data:image/png;base64,${b64Img}` : '') ||
        data.imageUrl ||
        data.videoUrl ||
        data.content_url ||
        data.url ||
        data.output_url ||
        (Array.isArray(data.output) ? data.output[0] : data.output) ||
        '';

    if (!outUrl) {
        throw new Error('Image/Render URL prapt nahi hua.');
    }
    return outUrl;
}

async function callGpuRenderEndpoint(promptText, kind, refImageUrl = '', allRefUrls = []) {
    let endpoint = getSavedGpuEndpoint();
    if (!endpoint) {
        const cfg = await openGpuConnectPopup(false);
        endpoint = cfg.endpointUrl;
    }

    endpoint = sanitizeEndpointUrl(endpoint);
    if (!endpoint) {
        throw new Error('Endpoint URL set nahi hai.');
    }

    const apiKey = (localStorage.getItem(GPU_API_KEY_STORAGE_KEY) || '').trim();
    const meta = getSavedGpuMeta();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const attachedRefs = Array.isArray(allRefUrls) && allRefUrls.length
        ? allRefUrls
        : (refImageUrl ? [refImageUrl] : []);
    const primaryRef = refImageUrl || attachedRefs[0] || '';

    const finalPrompt = formatPromptForRender(promptText, kind, primaryRef, attachedRefs);
    const primarySize = resolveRenderSize(promptText, kind);
    const primaryModel = meta.model || DEFAULT_AICREDITS_IMAGE_MODEL;
    const isImagesEndpoint = /\/images\/generations/i.test(endpoint);

    const attempts = [
        { model: primaryModel, size: primarySize },
        { model: primaryModel, size: '1344x768' },
        { model: DEFAULT_AICREDITS_IMAGE_MODEL, size: '1024x1024' }
    ];

    let lastErr = null;
    for (const attempt of attempts) {
        const bodyPayload = isImagesEndpoint
            ? {
                  model: attempt.model,
                  prompt: finalPrompt,
                  n: 1,
                  size: attempt.size,
                  reference_image: primaryRef || null,
                  reference_images: attachedRefs
              }
            : {
                  kind,
                  prompt: finalPrompt,
                  size: attempt.size,
                  model: attempt.model,
                  referenceImage: primaryRef || null,
                  referenceImages: attachedRefs
              };

        try {
            return await requestSingleGpuRender(endpoint, headers, bodyPayload);
        } catch (err) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('Render fail hua.');
}

function isVideoMediaUrl(url = '') {
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function syncReferenceImagesToScenes() {
    const scenePhotos = labData.photos.map((p) => p.imageUrl).filter(Boolean);

    labData.photos.forEach((ph, idx) => {
        const combinedText = `${ph.label || ''} ${ph.prompt || ''}`;
        const detected = detectCharactersInSceneText(combinedText, idx);

        if (ph.manualRefUrl) {
            ph.detectedCharacters = detected.matched.map((m) => m.label);
            ph.allRefUrls = [ph.manualRefUrl];
            ph.activeRefUrl = ph.manualRefUrl;
        } else if (detected.matched.length > 0) {
            ph.detectedCharacters = detected.matched.map((m) => m.label);
            ph.allRefUrls = detected.matched.map((m) => m.imageUrl);
            ph.activeRefUrl = ph.allRefUrls[0] || '';
        } else {
            ph.detectedCharacters = [];
            ph.allRefUrls = [];
            ph.activeRefUrl = '';
        }
    });

    labData.scenes.forEach((sc, idx) => {
        const sceneNumMatch = (sc.label || '').match(/सीन\s*(\d+)|scene\s*(\d+)/i);
        const parsedSceneNum = sceneNumMatch ? parseInt(sceneNumMatch[1] || sceneNumMatch[2], 10) : NaN;

        let matchedPhotoUrl = '';
        if (sc.manualRefUrl) {
            matchedPhotoUrl = sc.manualRefUrl;
        } else if (!Number.isNaN(parsedSceneNum) && parsedSceneNum >= 1 && labData.photos[parsedSceneNum - 1]?.imageUrl) {
            matchedPhotoUrl = labData.photos[parsedSceneNum - 1].imageUrl;
        } else if (labData.photos[idx]?.imageUrl) {
            matchedPhotoUrl = labData.photos[idx].imageUrl;
        } else if (scenePhotos.length > 0) {
            matchedPhotoUrl = scenePhotos[idx % scenePhotos.length];
        }

        const detected = detectCharactersInSceneText(`${sc.label || ''} ${sc.prompt || ''}`, idx);
        sc.detectedCharacters = detected.matched.map((m) => m.label);
        sc.sourcePhotoUrl = matchedPhotoUrl;
        sc.allRefUrls = matchedPhotoUrl ? [matchedPhotoUrl] : detected.matched.map((m) => m.imageUrl);
        sc.activeRefUrl = matchedPhotoUrl || (detected.matched[0]?.imageUrl || '');
    });
}

function createStudioRow(item, kind, onUpdate) {
    const row = document.createElement('div');
    row.className = 'studio-row';

    const promptSide = document.createElement('div');
    promptSide.className = 'prompt-side';

    const labelRow = document.createElement('div');
    labelRow.className = 'row-label';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = item.label;
    labelRow.appendChild(titleSpan);

    if (kind === 'photo' || kind === 'scene') {
        const refBadge = document.createElement('span');
        refBadge.className = 'ref-badge';
        const refCount = Array.isArray(item.allRefUrls) && item.allRefUrls.length ? item.allRefUrls.length : (item.activeRefUrl ? 1 : 0);
        refBadge.textContent = refCount > 0 ? `${refCount} Ref Photo(s) Linked ✓` : 'Waiting for Ref Photo';
        labelRow.appendChild(refBadge);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'studio-textarea';
    textarea.placeholder =
        kind === 'char' ? 'Character Reference Prompt yahan auto paste hoga...' :
        kind === 'photo' ? 'Scene Photo Prompt yahan auto paste hoga...' :
        'Scene Video Prompt yahan auto paste hoga...';
    textarea.value = item.prompt || '';

    textarea.addEventListener('input', () => {
        item.prompt = textarea.value;
        persistLabData();
    });

    const actionBar = document.createElement('div');
    actionBar.className = 'action-bar';

    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'lab1-btn go';
    goBtn.textContent = 'GO';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'lab1-btn reload';
    reloadBtn.textContent = '↻ Reload';
    reloadBtn.style.display = item.status === 'error' ? 'inline-block' : 'none';

    const countdownSpan = document.createElement('span');
    countdownSpan.className = 'retry-countdown';

    actionBar.appendChild(goBtn);
    actionBar.appendChild(reloadBtn);
    actionBar.appendChild(countdownSpan);

    if (kind === 'photo' || kind === 'scene') {
        const refWrap = document.createElement('div');
        refWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:4px;';

        const thumb = document.createElement('img');
        thumb.alt = 'Ref';
        thumb.style.cssText = 'width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid #3b82f6;display:none;cursor:pointer;';
        if (item.activeRefUrl) {
            thumb.src = item.activeRefUrl;
            thumb.style.display = 'inline-block';
            attachPressAndHoldZoom(thumb, () => item.activeRefUrl, () => `${item.label || 'Scene'} - Ref Photo`);
        }

        const picker = document.createElement('select');
        picker.style.cssText = 'background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 6px;font-size:11px;max-width:140px;';

        const autoOpt = document.createElement('option');
        autoOpt.value = '__AUTO__';
        autoOpt.textContent = 'Auto Ref';
        picker.appendChild(autoOpt);

        const sourcePool = kind === 'photo' ? labData.characters : labData.photos;
        sourcePool.forEach((srcItem, sIdx) => {
            if (srcItem.imageUrl) {
                const opt = document.createElement('option');
                opt.value = srcItem.imageUrl;
                opt.textContent = `${sIdx + 1}. ${srcItem.label || `Item ${sIdx + 1}`}`;
                picker.appendChild(opt);
            }
        });

        picker.value = item.manualRefUrl || '__AUTO__';
        picker.addEventListener('change', () => {
            item.manualRefUrl = picker.value === '__AUTO__' ? '' : picker.value;
            persistLabData();
            onUpdate();
        });

        refWrap.appendChild(thumb);
        refWrap.appendChild(picker);
        actionBar.appendChild(refWrap);
    }

    promptSide.appendChild(labelRow);
    promptSide.appendChild(textarea);
    promptSide.appendChild(actionBar);

    const outputSide = document.createElement('div');
    outputSide.className = 'output-side';

    const frame = document.createElement('div');
    frame.className = 'output-frame';

    const actions = document.createElement('div');
    actions.className = 'output-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'lab1-btn secondary';
    downloadBtn.textContent = '⬇ Download';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'lab1-btn secondary';
    copyBtn.textContent = '📋 Copy';

    actions.appendChild(downloadBtn);
    actions.appendChild(copyBtn);

    function paintOutput() {
        frame.innerHTML = '';
        reloadBtn.style.display = item.status === 'error' ? 'inline-block' : 'none';

        if (item.status === 'loading') {
            const p = document.createElement('div');
            p.className = 'output-placeholder';
            p.textContent = 'Rendering chal rahi hai...';
            frame.appendChild(p);
        } else if (item.status === 'error') {
            const errEl = document.createElement('div');
            errEl.className = 'output-error';
            errEl.textContent = item.errorMsg || 'Error aaya.';
            frame.appendChild(errEl);
        } else if (item.imageUrl) {
            if (isVideoMediaUrl(item.imageUrl)) {
                const vid = document.createElement('video');
                vid.className = 'output-video';
                vid.src = item.imageUrl;
                vid.controls = true;
                vid.autoplay = true;
                vid.loop = true;
                vid.muted = true;
                vid.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px;';
                frame.appendChild(vid);
            } else {
                const img = document.createElement('img');
                img.className = 'output-image';
                img.src = item.imageUrl;
                img.alt = item.label || 'Reference Photo';
                img.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;max-height:260px;object-fit:contain;border-radius:8px;';
                attachPressAndHoldZoom(img, () => item.imageUrl, () => item.label || 'Reference Photo');
                frame.appendChild(img);
            }
        } else {
            const p = document.createElement('div');
            p.className = 'output-placeholder';
            p.textContent =
                kind === 'char' ? 'GO dabayein — reference photo yahan aayega.' :
                kind === 'photo' ? 'Reference photo aur scene prompt taiyar — GO dabayein.' :
                'Scene photo aur video prompt taiyar — GO dabayein.';
            frame.appendChild(p);
        }
    }

    function scheduleAutoRetry() {
        clearRetryTimer(item.id);
        let left = AUTO_RETRY_SECONDS;
        countdownSpan.textContent = `Auto retry in ${left}s...`;

        const timer = setInterval(() => {
            left -= 1;
            if (left > 0) {
                countdownSpan.textContent = `Auto retry in ${left}s...`;
            } else {
                clearRetryTimer(item.id);
                countdownSpan.textContent = '';
                runRender();
            }
        }, 1000);

        retryTimers.set(item.id, timer);
    }

    async function runRender() {
        clearRetryTimer(item.id);
        countdownSpan.textContent = '';

        const promptVal = (textarea.value || '').trim();
        item.prompt = promptVal;
        if (!promptVal) {
            item.status = 'error';
            item.errorMsg = 'Prompt khali hai.';
            persistLabData();
            paintOutput();
            scheduleAutoRetry();
            return;
        }

        if (!getSavedGpuEndpoint()) {
            try {
                await openGpuConnectPopup(false);
            } catch (popupErr) {
                item.status = 'error';
                item.errorMsg = popupErr?.message || 'Endpoint URL save karna zaroori hai.';
                persistLabData();
                paintOutput();
                return;
            }
        }

        item.status = 'loading';
        item.errorMsg = '';
        persistLabData();
        paintOutput();

        try {
            const renderKind =
                kind === 'char' ? 'character_reference' :
                kind === 'photo' ? 'scene_photo' :
                'scene_video_step';

            const outUrl = await callGpuRenderEndpoint(
                promptVal,
                renderKind,
                item.activeRefUrl || '',
                item.allRefUrls || []
            );
            item.imageUrl = outUrl;
            item.status = 'done';
            item.errorMsg = '';
            persistLabData();
            paintOutput();
            onUpdate();
        } catch (err) {
            item.status = 'error';
            item.errorMsg = err?.message || 'Render fail hua.';
            persistLabData();
            paintOutput();
            scheduleAutoRetry();
        }
    }

    goBtn.addEventListener('click', runRender);
    reloadBtn.addEventListener('click', runRender);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            runRender();
        }
    });

    downloadBtn.addEventListener('click', () => {
        if (!item.imageUrl) return;
        const a = document.createElement('a');
        a.href = item.imageUrl;
        a.download = isVideoMediaUrl(item.imageUrl) ? `${item.id}.mp4` : `${item.id}.png`;
        a.target = '_blank';
        a.click();
    });

    copyBtn.addEventListener('click', () => {
        const targetText = item.imageUrl || item.prompt || '';
        if (!targetText) return;
        navigator.clipboard.writeText(targetText).then(() => {
            copyBtn.textContent = '✅ Copied';
            setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1600);
        });
    });

    paintOutput();
    outputSide.appendChild(frame);
    outputSide.appendChild(actions);

    row.appendChild(promptSide);
    row.appendChild(outputSide);
    return row;
}

function renderAllSections() {
    syncReferenceImagesToScenes();
    persistLabData();
    bindGpuLabHeaderTrigger();
    bindBackNavigationButton();

    const charContainer = document.getElementById('charRefRowsContainer');
    const photoContainer = document.getElementById('scenePhotoRowsContainer');
    const sceneContainer = document.getElementById('sceneVideoRowsContainer');

    if (charContainer) {
        charContainer.innerHTML = '';
        if (!labData.characters.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'Character reference prompt aate hi yahan box apne aap ban jayenge.';
            charContainer.appendChild(empty);
        } else {
            labData.characters.forEach((charItem) => {
                charContainer.appendChild(createStudioRow(charItem, 'char', renderAllSections));
            });
        }
    }

    if (photoContainer) {
        photoContainer.innerHTML = '';
        if (!labData.photos.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'Scene photo prompt aate hi yahan photo box apne aap ban jayenge.';
            photoContainer.appendChild(empty);
        } else {
            labData.photos.forEach((photoItem) => {
                photoContainer.appendChild(createStudioRow(photoItem, 'photo', renderAllSections));
            });
        }
    }

    if (sceneContainer) {
        sceneContainer.innerHTML = '';
        if (!labData.scenes.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'Video section abhi khali hai.';
            sceneContainer.appendChild(empty);
        } else {
            labData.scenes.forEach((sceneItem) => {
                sceneContainer.appendChild(createStudioRow(sceneItem, 'scene', renderAllSections));
            });
        }
    }
}

// =========================================================
// JSON EXPORT / IMPORT HELPERS
// =========================================================

function exportLabDataToJsonFile() {
    try {
        const snapshot = {
            app: 'AGC_GPU_LAB1',
            sessionId,
            exportedAt: new Date().toISOString(),
            data: labData
        };
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lab1-project-${sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
        console.error('JSON export error:', err);
    }
}

function applyImportedJsonData(parsedJson) {
    const incomingData = parsedJson?.data && typeof parsedJson.data === 'object'
        ? parsedJson.data
        : parsedJson;

    if (!incomingData || typeof incomingData !== 'object') {
        throw new Error('Invalid JSON format');
    }

    labData = {
        characters: Array.isArray(incomingData.characters) ? incomingData.characters : [],
        photos: Array.isArray(incomingData.photos) ? incomingData.photos : [],
        scenes: Array.isArray(incomingData.scenes) ? incomingData.scenes : []
    };

    syncReferenceImagesToScenes();
    persistLabData();
    renderAllSections();
}

function triggerImportLabJsonFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || '{}'));
                applyImportedJsonData(parsed);
            } catch (err) {
                alert('JSON file padhne mein dikkat aayi: ' + (err?.message || err));
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

async function ensureGpuReadyBeforeBatch() {
    if (!getSavedGpuEndpoint()) {
        await openGpuConnectPopup(false);
    }
}

function triggerAllGoInContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const goButtons = Array.from(container.querySelectorAll('.lab1-btn.go'));
    goButtons.forEach((btn) => btn.click());
}

async function runCharGoAllOnly() {
    try {
        await ensureGpuReadyBeforeBatch();
    } catch (_) {
        return;
    }

    triggerAllGoInContainer('charRefRowsContainer');
}

async function runPhotoGoAllOnly() {
    try {
        await ensureGpuReadyBeforeBatch();
    } catch (_) {
        return;
    }

    renderAllSections();
    triggerAllGoInContainer('scenePhotoRowsContainer');
}

async function runVideoGoAllOnly() {
    try {
        await ensureGpuReadyBeforeBatch();
    } catch (_) {
        return;
    }

    renderAllSections();
    triggerAllGoInContainer('sceneVideoRowsContainer');
}

document.addEventListener('DOMContentLoaded', () => {
    renderAllSections();
    bindGpuLabHeaderTrigger();
    bindBackNavigationButton();
});

document.getElementById('goAllCharBtn')?.addEventListener('click', runCharGoAllOnly);
document.getElementById('goAllPhotoBtn')?.addEventListener('click', runPhotoGoAllOnly);
document.getElementById('goAllVideoBtn')?.addEventListener('click', runVideoGoAllOnly);
