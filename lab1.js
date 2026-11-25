const LAB1_STATE_KEY = 'agc_gpu_lab1_state_48h';
const FULL_CHAT_ARCHIVE_KEY = 'agc_full_chat_history_48h';
const ACTIVE_SESSION_KEY = 'agc_active_session_id';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const AUTO_RETRY_SECONDS = 10;

const GPU_ENDPOINT_STORAGE_KEY = 'agc_gpu_render_url';
const GPU_API_KEY_STORAGE_KEY = 'apiKey';
const GPU_META_STORAGE_KEY = 'agc_gpu_endpoint_meta_v1';

const retryTimers = new Map();
let activeGpuPopupPromise = null;

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
    const map = loadLabStateMap();
    map[sessionId] = {
        sessionId,
        updatedAt: Date.now(),
        data: labData
    };
    localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(map));
}

function clearRetryTimer(rowId) {
    if (retryTimers.has(rowId)) {
        clearInterval(retryTimers.get(rowId));
        retryTimers.delete(rowId);
    }
}

function openZoomModal(imgSrc) {
    const modal = document.getElementById('zoomModalOverlay');
    const modalImg = document.getElementById('zoomModalImage');
    if (!modal || !modalImg || !imgSrc) return;
    modalImg.src = imgSrc;
    modal.style.display = 'flex';
}

function attachPressAndHoldZoom(imgEl, getSrcFn) {
    let holdTimer = null;

    const startHold = () => {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            const src = getSrcFn();
            if (src) openZoomModal(src);
        }, 450);
    };

    const cancelHold = () => clearTimeout(holdTimer);

    imgEl.addEventListener('pointerdown', startHold);
    imgEl.addEventListener('pointerup', cancelHold);
    imgEl.addEventListener('pointerleave', cancelHold);
    imgEl.addEventListener('pointercancel', cancelHold);
    imgEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// =========================================================
// ONE-TIME GPU CONNECTION CONFIG & POPUP (API KEY OPTIONAL)
// =========================================================

function getSavedGpuEndpoint() {
    return (
        localStorage.getItem(GPU_ENDPOINT_STORAGE_KEY) ||
        localStorage.getItem('baseUrl') ||
        ''
    ).trim();
}

function getSavedGpuMeta() {
    try {
        const raw = localStorage.getItem(GPU_META_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { model: '', note: '' };
    } catch (_) {
        return { model: '', note: '' };
    }
}

function saveGpuConnectionSettings({ endpointUrl, apiKey = '', model = '', note = '' }) {
    const cleanUrl = (endpointUrl || '').trim();
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

function openGpuConnectPopup(forceOpen = false) {
    if (activeGpuPopupPromise) {
        return activeGpuPopupPromise;
    }

    activeGpuPopupPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById('agcOneTimeGpuModal');
        if (existing) existing.remove();

        const currentEndpoint = getSavedGpuEndpoint();
        const currentKey = localStorage.getItem(GPU_API_KEY_STORAGE_KEY) || '';
        const currentMeta = getSavedGpuMeta();

        if (!forceOpen && currentEndpoint) {
            activeGpuPopupPromise = null;
            resolve({
                endpointUrl: currentEndpoint,
                apiKey: currentKey,
                model: currentMeta.model || '',
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
                    GPU Connect (One-Time Setup)
                </div>
                <div style="font-size: 12px; color: #94a3b8; line-height: 1.45; margin-bottom: 14px;">
                    GPU URL એકવાર સેવ કરી લો — ફરી-ફરી નાખવાની જરૂર નહીં પડે. API Key હમણાં જરૂરી નથી (ખાલી છોડી શકો છો).
                </div>

                <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
                    GPU Endpoint / Render URL *
                </label>
                <input
                    id="agcGpuUrlInput"
                    type="text"
                    value="${currentEndpoint}"
                    placeholder="https://your-gpu-endpoint/generate"
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
                    API Key (Optional — ન હોય તો ખાલી રાખો)
                </label>
                <input
                    id="agcGpuKeyInput"
                    type="text"
                    value="${currentKey}"
                    placeholder="Optional API Key / Token"
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
                    Model / Pod Note (Optional)
                </label>
                <input
                    id="agcGpuModelInput"
                    type="text"
                    value="${currentMeta.model || ''}"
                    placeholder="Optional model name or note"
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
            const rawUrl = (urlInput.value || '').trim();
            if (!rawUrl) {
                errBox.textContent = 'કૃપા કરીને GPU Endpoint URL નાખો.';
                return;
            }
            if (!/^https?:\/\//i.test(rawUrl)) {
                errBox.textContent = 'URL http:// અથવા https:// થી શરૂ થવો જોઈએ.';
                return;
            }

            const saved = saveGpuConnectionSettings({
                endpointUrl: rawUrl,
                apiKey: keyInput.value || '',
                model: modelInput.value || '',
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

async function callGpuRenderEndpoint(promptText, kind, refImageUrl = '', allRefUrls = []) {
    let endpoint = getSavedGpuEndpoint();
    if (!endpoint) {
        const cfg = await openGpuConnectPopup(false);
        endpoint = cfg.endpointUrl;
    }

    if (!endpoint) {
        throw new Error('GPU render endpoint set नहीं है।');
    }

    const apiKey = (localStorage.getItem(GPU_API_KEY_STORAGE_KEY) || '').trim();
    const meta = getSavedGpuMeta();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            kind,
            prompt: promptText,
            model: meta.model || undefined,
            referenceImage: refImageUrl || null,
            referenceImages: Array.isArray(allRefUrls) ? allRefUrls : (refImageUrl ? [refImageUrl] : [])
        })
    });

    if (!res.ok) {
        throw new Error(`GPU error (${res.status})`);
    }

    const data = await res.json();
    const outUrl =
        data.imageUrl ||
        data.videoUrl ||
        data.content_url ||
        data.url ||
        data.output_url ||
        (Array.isArray(data.output) ? data.output[0] : data.output) ||
        '';

    if (!outUrl) {
        throw new Error('Render output URL प्राप्त नहीं हुआ।');
    }
    return outUrl;
}

function isVideoMediaUrl(url = '') {
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function syncReferenceImagesToScenes() {
    const charItemsWithImg = labData.characters.filter((c) => Boolean(c.imageUrl));
    const charRefs = charItemsWithImg.map((c) => c.imageUrl);
    const scenePhotos = labData.photos.map((p) => p.imageUrl).filter(Boolean);

    const findBestRefForText = (promptText = '', fallbackIdx = 0) => {
        if (!charItemsWithImg.length) return '';
        const lowerPrompt = (promptText || '').toLowerCase();

        for (const ch of charItemsWithImg) {
            const cleanLabel = (ch.label || '')
                .replace(/^स्टेप\s*\d+\s*:\s*/i, '')
                .replace(/^character\s*\d*\s*:\s*/i, '')
                .split('(')[0]
                .trim()
                .toLowerCase();

            if (cleanLabel && cleanLabel.length >= 2 && lowerPrompt.includes(cleanLabel)) {
                return ch.imageUrl;
            }
        }

        return charRefs[fallbackIdx % charRefs.length] || '';
    };

    // 1 -> 2: Character Reference Photos -> Scene Photo Studio
    labData.photos.forEach((ph, idx) => {
        ph.allRefUrls = charRefs;
        if (ph.manualRefUrl) {
            ph.activeRefUrl = ph.manualRefUrl;
        } else if (typeof ph.refIndex === 'number' && labData.characters[ph.refIndex]?.imageUrl) {
            ph.activeRefUrl = labData.characters[ph.refIndex].imageUrl;
        } else {
            ph.activeRefUrl = findBestRefForText(ph.prompt, idx);
        }
    });

    // 2 -> 3: Scene Photos -> Scene Video Studio
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

        sc.sourcePhotoUrl = matchedPhotoUrl;
        sc.allRefUrls = charRefs;
        sc.activeRefUrl = matchedPhotoUrl || findBestRefForText(sc.prompt, idx);
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
        refBadge.textContent = item.activeRefUrl ? 'Ref Photo Linked ✓' : 'Waiting for Ref Photo';
        labelRow.appendChild(refBadge);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'studio-textarea';
    textarea.placeholder =
        kind === 'char' ? 'Character Reference Prompt यहाँ ऑटो पेस्ट होगा...' :
        kind === 'photo' ? 'Scene Photo Prompt यहाँ ऑटो पेस्ट होगा...' :
        'Scene Video Prompt यहाँ ऑटो पेस्ट होगा...';
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
            thumb.addEventListener('click', () => openZoomModal(item.activeRefUrl));
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
            p.textContent = 'GPU रेंडरिंग चल रही है...';
            frame.appendChild(p);
        } else if (item.status === 'error') {
            const errEl = document.createElement('div');
            errEl.className = 'output-error';
            errEl.textContent = item.errorMsg || 'GPU एरर आया।';
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
                img.alt = item.label;
                attachPressAndHoldZoom(img, () => item.imageUrl);
                frame.appendChild(img);
            }
        } else {
            const p = document.createElement('div');
            p.className = 'output-placeholder';
            p.textContent =
                kind === 'char' ? 'GO दबाएं — रेफरेंस फोटो यहाँ आएगा।' :
                kind === 'photo' ? 'रेफरेंस फोटो व सीन प्रॉम्प्ट तैयार — GO दबाएं।' :
                'सीन फोटो व वीडियो प्रॉम्प्ट तैयार — GO दबाएं।';
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
            item.errorMsg = 'Prompt खाली है।';
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
                item.errorMsg = popupErr?.message || 'GPU URL સેવ કરવો જરૂરી છે.';
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
            onUpdate();
        } catch (err) {
            item.status = 'error';
            item.errorMsg = err?.message || 'GPU रेंडर फेल हुआ।';
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

    const charContainer = document.getElementById('charRefRowsContainer');
    const photoContainer = document.getElementById('scenePhotoRowsContainer');
    const sceneContainer = document.getElementById('sceneVideoRowsContainer');

    if (charContainer) {
        charContainer.innerHTML = '';
        if (!labData.characters.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'कैरेक्टर रेफरेंस प्रॉम्प्ट आते ही यहाँ बॉक्स अपने आप बन जाएंगे।';
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
            empty.textContent = 'सीन फ़ोटो प्रॉम्प्ट आते ही यहाँ फ़ोटो बॉक्स अपने आप बन जाएंगे।';
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
            empty.textContent = 'वीडियो सेक्शन अभी खाली है (ताकि खिचड़ी न बने)।';
            sceneContainer.appendChild(empty);
        } else {
            labData.scenes.forEach((sceneItem) => {
                sceneContainer.appendChild(createStudioRow(sceneItem, 'scene', renderAllSections));
            });
        }
    }
}

async function waitForSectionCompletion(itemsList, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const withPrompts = itemsList.filter((it) => (it.prompt || '').trim().length > 0);
        if (!withPrompts.length) return true;
        if (withPrompts.every((it) => it.status === 'done' && Boolean(it.imageUrl))) {
            return true;
        }
        await new Promise((r) => setTimeout(r, 800));
    }
    return false;
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

async function runCharGoAllAutoChain() {
    try {
        await ensureGpuReadyBeforeBatch();
    } catch (_) {
        return;
    }

    triggerAllGoInContainer('charRefRowsContainer');
    const charsReady = await waitForSectionCompletion(labData.characters);
    if (!charsReady) return;

    renderAllSections();
    await new Promise((r) => setTimeout(r, 300));

    if (labData.photos.some((p) => (p.prompt || '').trim())) {
        triggerAllGoInContainer('scenePhotoRowsContainer');
        const photosReady = await waitForSectionCompletion(labData.photos);
        if (!photosReady) return;

        renderAllSections();
        await new Promise((r) => setTimeout(r, 300));

        if (labData.scenes.some((s) => (s.prompt || '').trim())) {
            triggerAllGoInContainer('sceneVideoRowsContainer');
        }
    }
}

async function runPhotoGoAllAutoChain() {
    try {
        await ensureGpuReadyBeforeBatch();
    } catch (_) {
        return;
    }

    renderAllSections();
    triggerAllGoInContainer('scenePhotoRowsContainer');
    const photosReady = await waitForSectionCompletion(labData.photos);
    if (!photosReady) return;

    renderAllSections();
    await new Promise((r) => setTimeout(r, 300));

    if (labData.scenes.some((s) => (s.prompt || '').trim())) {
        triggerAllGoInContainer('sceneVideoRowsContainer');
    }
}

async function runVideoGoAllAutoChain() {
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
});

document.getElementById('goAllCharBtn')?.addEventListener('click', runCharGoAllAutoChain);
document.getElementById('goAllPhotoBtn')?.addEventListener('click', runPhotoGoAllAutoChain);
document.getElementById('goAllVideoBtn')?.addEventListener('click', runVideoGoAllAutoChain);
