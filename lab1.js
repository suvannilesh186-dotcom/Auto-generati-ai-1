const LAB1_STATE_KEY = 'agc_gpu_lab1_state_48h';
const FULL_CHAT_ARCHIVE_KEY = 'agc_full_chat_history_48h';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const AUTO_RETRY_SECONDS = 10;

const retryTimers = new Map();

function getActiveOrLatestSessionId() {
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

    const latestEntry = Object.values(map)
        .filter((e) => e && e.data && ((e.data.characters && e.data.characters.length) || (e.data.scenes && e.data.scenes.length)))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

    if (latestEntry && latestEntry.data) {
        return latestEntry.data;
    }

    return { characters: [], scenes: [] };
}

const sessionId = getActiveOrLatestSessionId();
let labData = loadLabDataForSession(sessionId);
if (!Array.isArray(labData.characters)) labData.characters = [];
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

async function callGpuRenderEndpoint(promptText, kind, refImageUrl = '') {
    const endpoint =
        localStorage.getItem('agc_gpu_render_url') ||
        localStorage.getItem('baseUrl') ||
        '';

    if (!endpoint) {
        throw new Error('GPU render endpoint set नहीं है।');
    }

    const apiKey = localStorage.getItem('apiKey') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            kind,
            prompt: promptText,
            referenceImage: refImageUrl || null
        })
    });

    if (!res.ok) {
        throw new Error(`GPU error (${res.status})`);
    }

    const data = await res.json();
    const outUrl = data.imageUrl || data.url || data.output_url || '';
    if (!outUrl) {
        throw new Error('Render output URL प्राप्त नहीं हुआ।');
    }
    return outUrl;
}

function syncReferenceImagesToScenes() {
    const availableRefs = labData.characters.map((c) => c.imageUrl).filter(Boolean);
    labData.scenes.forEach((sc, idx) => {
        if (availableRefs.length > 0) {
            const pickIdx = typeof sc.refIndex === 'number' && sc.refIndex < availableRefs.length
                ? sc.refIndex
                : idx % availableRefs.length;
            sc.activeRefUrl = availableRefs[pickIdx];
        } else {
            sc.activeRefUrl = '';
        }
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

    if (kind === 'scene') {
        const refBadge = document.createElement('span');
        refBadge.className = 'ref-badge';
        refBadge.textContent = item.activeRefUrl ? 'Ref Photo Linked ✓' : 'Waiting for Ref Photo';
        labelRow.appendChild(refBadge);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'studio-textarea';
    textarea.placeholder = kind === 'char'
        ? 'Character Reference Prompt यहाँ ऑटो पेस्ट होगा...'
        : 'Scene Video Prompt यहाँ ऑटो पेस्ट होगा...';
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
            const img = document.createElement('img');
            img.className = 'output-image';
            img.src = item.imageUrl;
            img.alt = item.label;
            attachPressAndHoldZoom(img, () => item.imageUrl);
            frame.appendChild(img);
        } else {
            const p = document.createElement('div');
            p.className = 'output-placeholder';
            p.textContent = kind === 'char'
                ? 'GO दबाएं — रेफरेंस फोटो यहाँ आएगा।'
                : 'रेफरेंस फोटो व प्रॉम्प्ट तैयार — GO दबाएं।';
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

        item.status = 'loading';
        item.errorMsg = '';
        persistLabData();
        paintOutput();

        try {
            const outUrl = await callGpuRenderEndpoint(
                promptVal,
                kind === 'char' ? 'character_reference' : 'scene_video_step',
                item.activeRefUrl || ''
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

    downloadBtn.addEventListener('click', () => {
        if (!item.imageUrl) return;
        const a = document.createElement('a');
        a.href = item.imageUrl;
        a.download = `${item.id}.png`;
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

    const charContainer = document.getElementById('charRefRowsContainer');
    const sceneContainer = document.getElementById('sceneVideoRowsContainer');

    if (charContainer) {
        charContainer.innerHTML = '';
        if (!labData.characters.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'ऑटोमेशन से कैरेक्टर प्रॉम्प्ट्स आते ही यहाँ बॉक्स अपने आप बन जाएंगे।';
            charContainer.appendChild(empty);
        } else {
            labData.characters.forEach((charItem) => {
                charContainer.appendChild(createStudioRow(charItem, 'char', renderAllSections));
            });
        }
    }

    if (sceneContainer) {
        sceneContainer.innerHTML = '';
        if (!labData.scenes.length) {
            const empty = document.createElement('div');
            empty.className = 'output-placeholder';
            empty.textContent = 'ऑटोमेशन से वीडियो स्टेप्स आते ही यहाँ बॉक्स व रेफरेंस फोटो अपने आप जुड़ जाएंगे।';
            sceneContainer.appendChild(empty);
        } else {
            labData.scenes.forEach((sceneItem) => {
                sceneContainer.appendChild(createStudioRow(sceneItem, 'scene', renderAllSections));
            });
        }
    }
}

document.getElementById('backToDashBtn')?.addEventListener('click', () => {
    window.location.assign('dashboard.html');
});

document.getElementById('addCharRowBtn')?.addEventListener('click', () => {
    const nextNum = labData.characters.length + 1;
    labData.characters.push({
        id: `char_${Date.now()}_${nextNum}`,
        label: `Character ${nextNum}`,
        prompt: '',
        imageUrl: '',
        status: 'idle',
        errorMsg: ''
    });
    persistLabData();
    renderAllSections();
});

document.getElementById('addSceneRowBtn')?.addEventListener('click', () => {
    const nextNum = labData.scenes.length + 1;
    labData.scenes.push({
        id: `scene_step_${Date.now()}_${nextNum}`,
        label: `Scene Step ${nextNum}`,
        refIndex: nextNum - 1,
        prompt: '',
        imageUrl: '',
        status: 'idle',
        errorMsg: ''
    });
    persistLabData();
    renderAllSections();
});

document.getElementById('closeZoomModalBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('zoomModalOverlay');
    if (modal) modal.style.display = 'none';
});

document.getElementById('zoomModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'zoomModalOverlay') {
        e.currentTarget.style.display = 'none';
    }
});

renderAllSections();
