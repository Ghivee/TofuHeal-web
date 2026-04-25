// --- MODULE 1: UI & DOM ELEMENTS ---
const dashboardView = document.getElementById('dashboard-view');
const cameraView = document.getElementById('camera-view');
const videoFeed = document.getElementById('camera-feed');
const btnOpenCamera = document.getElementById('btn-open-camera');
const btnCloseCamera = document.getElementById('btn-close-camera');
const btnCapture = document.getElementById('btn-capture');
const cleanRgbBox = document.getElementById('clean-rgb-box');

let streamData = null;
let isProcessing = false;
let resizeObserver = null;

// Initialize History
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    lucide.createIcons();
});

const btnClearHistory = document.getElementById('btn-clear-history');
btnClearHistory.addEventListener('click', clearHistory);

function showToast(message) {
    const toast = document.getElementById('error-toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 4500);
}

// --- MODULE 2: CAMERA & SVG MASK ---
function toggleView(showEl, hideEl) {
    hideEl.classList.remove('show');
    hideEl.classList.add('hide');
    setTimeout(() => {
        showEl.classList.remove('hide');
        showEl.classList.add('show');
    }, 100);
}

let currentFacingMode = 'environment';
let isFlashOn = false;

async function openCamera(facingMode = 'environment') {
    if (streamData) streamData.getTracks().forEach(track => track.stop());
    
    try {
        streamData = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        videoFeed.srcObject = streamData;

        videoFeed.onloadedmetadata = () => {
            updateSvgStencil();
            setupResizeObserver();
        };

        currentFacingMode = facingMode;
        isFlashOn = false;
        const btnFlash = document.getElementById('btn-toggle-flash');
        if(btnFlash) {
            btnFlash.style.backgroundColor = 'rgba(15, 23, 42, 0.4)';
            btnFlash.style.color = 'white';
        }

    } catch (err) {
        showToast("Akses kamera ditolak. Pastikan memberikan izin kamera pada browser.");
        closeCamera();
    }
}

btnOpenCamera.addEventListener('click', () => {
    toggleView(cameraView, dashboardView);
    openCamera('environment');
});

const btnSwitchCamera = document.getElementById('btn-switch-camera');
if (btnSwitchCamera) {
    btnSwitchCamera.addEventListener('click', () => {
        const newMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
        openCamera(newMode);
    });
}

const btnToggleFlash = document.getElementById('btn-toggle-flash');
if (btnToggleFlash) {
    btnToggleFlash.addEventListener('click', async () => {
        if (!streamData) return;
        const track = streamData.getVideoTracks()[0];
        
        try {
            const capabilities = track.getCapabilities();
            if (!capabilities.torch) {
                showToast("Kamera ini tidak mendukung fitur lampu senter di browser.");
                return;
            }

            isFlashOn = !isFlashOn;
            await track.applyConstraints({
                advanced: [{ torch: isFlashOn }]
            });
            
            if(isFlashOn) {
                btnToggleFlash.style.backgroundColor = 'white';
                btnToggleFlash.style.color = '#f59e0b';
            } else {
                btnToggleFlash.style.backgroundColor = 'rgba(15, 23, 42, 0.4)';
                btnToggleFlash.style.color = 'white';
            }
        } catch (err) {
            showToast("Gagal menyalakan senter. Akses diblokir sistem.");
            isFlashOn = false;
        }
    });
}

btnCloseCamera.addEventListener('click', closeCamera);

function closeCamera() {
    if (streamData) streamData.getTracks().forEach(track => track.stop());
    toggleView(dashboardView, cameraView);
    if (resizeObserver) resizeObserver.disconnect();
    isProcessing = false;
}

// Dynamically scale SVG boxes maintaining strict 4:3 and 3:2 ratios regardless of screen size
function updateSvgStencil() {
    const wrapper = document.querySelector('.camera-wrapper');
    if (!wrapper) return;

    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;

    // Define the maximum allowed dimensions for the 4:3 box.
    // On desktop (landscape), width is huge, so we cap it relative to height.
    // On mobile (portrait), width is small, so we cap it relative to width.
    const maxAllowedW = w * 0.85; // 85% of screen width max
    const maxAllowedH = h * 0.60; // 60% of screen height max (leaves room for huge button at bottom)

    // Start by assuming width determines the size
    let box43_W = maxAllowedW;
    let box43_H = box43_W * (3 / 4);

    // If that height is too tall for the screen, switch to height-constrained sizing
    if (box43_H > maxAllowedH) {
        box43_H = maxAllowedH;
        box43_W = box43_H * (4 / 3);
    }

    // Safety check max limit for super wide screens
    if (box43_W > 600) {
        box43_W = 600;
        box43_H = box43_W * (3 / 4);
    }

    box43_W = Math.floor(box43_W);
    box43_H = Math.floor(box43_H);

    // Inner sensor box is STRICTLY 3:2. 
    // We make it occupy about half of the 4:3 box width.
    let box32_W = Math.floor(box43_W * 0.5);
    let box32_H = Math.floor(box32_W * (2 / 3));

    const cX = Math.floor(w / 2);
    const cY = Math.floor(h / 2);

    const setRect = (id, width, height) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('x', cX - width / 2);
        el.setAttribute('y', cY - height / 2);
        el.setAttribute('width', width);
        el.setAttribute('height', height);
    };

    setRect('mask-rect-43', box43_W, box43_H);
    setRect('outline-43', box43_W, box43_H);
    setRect('outline-32', box32_W, box32_H);

    const t43 = document.getElementById('text-43');
    if (t43) { t43.setAttribute('x', cX); t43.setAttribute('y', (cY - box43_H / 2) + 24); }

    const t32 = document.getElementById('text-32');
    if (t32) { t32.setAttribute('x', cX); t32.setAttribute('y', (cY - box32_H / 2) + 20); }

    window.boxParams = { box43_W, box43_H, box32_W, box32_H, cX, cY, w, h };
}

function setupResizeObserver() {
    const wrapper = document.querySelector('.camera-wrapper');
    resizeObserver = new ResizeObserver(() => {
        updateSvgStencil();
    });
    resizeObserver.observe(wrapper);
}


// --- MODULE 3: COLORIMETRY MATH ---
function rgbToHsv(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) h = 0;
    else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}


// --- MODULE 4: DIAGNOSTIC PIPELINE ---
btnCapture.addEventListener('click', () => {
    if (!videoFeed.videoWidth || isProcessing) return;
    isProcessing = true;

    if (!window.boxParams) {
        showToast("Mohon tunggu kamera fokus.");
        isProcessing = false;
        return;
    }

    const { box43_W, box43_H, box32_W, box32_H, cX, cY, w, h } = window.boxParams;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = w;
    canvas.height = h;

    const vW = videoFeed.videoWidth;
    const vH = videoFeed.videoHeight;
    const scale = Math.max(w / vW, h / vH);
    const drawW = vW * scale;
    const drawH = vH * scale;
    const startX = (w - drawW) / 2;
    const startY = (h - drawH) / 2;

    ctx.drawImage(videoFeed, startX, startY, drawW, drawH);

    const left43 = cX - box43_W / 2;
    const top43 = cY - box43_H / 2;

    // Bounds Check to prevent reading outside canvas
    if (left43 < 0 || top43 < 0 || left43 + box43_W > w || top43 + box43_H > h) {
        showToast("Resolusi kamera bermasalah. Coba rotasi HP Anda.");
        isProcessing = false;
        return;
    }

    const imgData = ctx.getImageData(left43, top43, box43_W, box43_H).data;

    let whitePixels = [];
    let sensorPixels = [];

    const left32_local = (cX - box32_W / 2) - left43;
    const right32_local = (cX + box32_W / 2) - left43;
    const top32_local = (cY - box32_H / 2) - top43;
    const bottom32_local = (cY + box32_H / 2) - top43;

    for (let y = 0; y < box43_H; y++) {
        for (let x = 0; x < box43_W; x++) {
            const i = (y * box43_W + x) * 4;
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];

            const isInside32 = (x >= left32_local && x <= right32_local && y >= top32_local && y <= bottom32_local);

            if (isInside32) {
                sensorPixels.push({ r, g, b });
            } else {
                whitePixels.push({ r, g, b });
            }
        }
    }

    const getStats = (pixelArr) => {
        if (pixelArr.length === 0) return { r: 1, g: 1, b: 1, noise: 0 };
        let sumR = 0, sumG = 0, sumB = 0;
        for (let p of pixelArr) { sumR += p.r; sumG += p.g; sumB += p.b; }
        const count = pixelArr.length;
        const mean = { r: sumR / count, g: sumG / count, b: sumB / count };

        let vr = 0, vg = 0, vb = 0;
        for (let p of pixelArr) {
            vr += Math.pow(p.r - mean.r, 2);
            vg += Math.pow(p.g - mean.g, 2);
            vb += Math.pow(p.b - mean.b, 2);
        }
        const noise = Math.sqrt((vr + vg + vb) / (count * 3));
        return {
            r: Math.round(mean.r),
            g: Math.round(mean.g),
            b: Math.round(mean.b),
            noise: noise
        };
    };

    const whiteStats = getStats(whitePixels);
    const sensorStats = getStats(sensorPixels);

    // Error Handling
    const maxAllowedNoise = 50;
    if (whiteStats.noise > maxAllowedNoise || sensorStats.noise > maxAllowedNoise) {
        showToast("PENYEJAJARAN GAGAL: Objek tidak sejajar. Terdapat kebocoran objek luar di area stensil.");
        isProcessing = false;
        return;
    }

    if (whiteStats.r < 75 && whiteStats.g < 75 && whiteStats.b < 75) {
        showToast("PENCAHAYAAN GAGAL: Sensor terlalu gelap. Cari sumber cahaya yang lebih terang.");
        isProcessing = false;
        return;
    }

    // Kalibrasi
    const correction = {
        r: 255 / (whiteStats.r || 1),
        g: 255 / (whiteStats.g || 1),
        b: 255 / (whiteStats.b || 1)
    };

    const calibratedRGB = {
        r: Math.min(255, Math.round(sensorStats.r * correction.r)),
        g: Math.min(255, Math.round(sensorStats.g * correction.g)),
        b: Math.min(255, Math.round(sensorStats.b * correction.b))
    };

    const hsv = rgbToHsv(calibratedRGB.r, calibratedRGB.g, calibratedRGB.b);

    if (hsv.v < 20) {
        showToast("ANALISIS GAGAL: Sampel sangat gelap.");
        isProcessing = false; return;
    }
    if (hsv.s < 10) {
        showToast("ANALISIS GAGAL: Warna terlalu pudar mencolok.");
        isProcessing = false; return;
    }

    // Critical Tofu-Heal Hue Check
    if (hsv.h > 65 && hsv.h < 330) {
        showToast(`ANALISIS GAGAL: Spektrum terbaca (${hsv.h}°). Diluar spektrum kurkumin.`);
        isProcessing = false; return;
    }

    updateDashboard(calibratedRGB, hsv);
    sendDataToServer(calibratedRGB, hsv);
    closeCamera();
});

// --- MODULE 5: LOCAL STORAGE & NETWORK ---
async function sendDataToServer(rgb, hsv) {
    const phEstimation = document.getElementById('ph-text').innerText;
    const status = document.getElementById('status-badge').innerText;

    saveToHistory({
        ph: phEstimation,
        status: status,
        date: new Date().toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
        rgb: rgb
    });

    try {
        await fetch('process.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rgb: rgb, hsv: hsv, ph_estimation: phEstimation })
        });
    } catch (err) {
        // Safe to ignore in static GitHub Pages environment
    }
}

function saveToHistory(item) {
    let history = JSON.parse(localStorage.getItem('tofu_history') || '[]');
    history.unshift(item);
    history = history.slice(0, 5);
    localStorage.setItem('tofu_history', JSON.stringify(history));
    loadHistory();
}

function loadHistory() {
    const historyList = document.getElementById('history-list');
    const history = JSON.parse(localStorage.getItem('tofu_history') || '[]');

    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox" class="empty-icon"></i>
                <p>Belum ada riwayat pemindaian</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    historyList.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="history-info">
                <span class="history-ph">${item.ph}</span>
                <span class="history-date">${item.date}</span>
            </div>
            <span class="history-badge ${getBadgeClass(item.status)}">${item.status}</span>
        </div>
    `).join('');

    lucide.createIcons();
}

function getBadgeClass(status) {
    if (status === 'NORMAL') return 'badge-normal';
    if (status === 'WARNING') return 'badge-warning';
    if (status === 'CRITICAL') return 'badge-critical';
    return '';
}

function clearHistory() {
    if (confirm('Yakin ingin menghapus seluruh riwayat lokal?')) {
        localStorage.removeItem('tofu_history');
        loadHistory();
    }
}

// --- MODULE 6: UPDATE DASHBOARD UI ---
function updateDashboard(rgb, hsv) {
    document.getElementById('tile-r').innerText = rgb.r;
    document.getElementById('tile-g').innerText = rgb.g;
    document.getElementById('tile-b').innerText = rgb.b;

    cleanRgbBox.style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    const dropIcon = cleanRgbBox.querySelector('.drop-icon');
    if (dropIcon) {
        const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        dropIcon.style.color = luminance > 128 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
    }

    const globalText = document.getElementById('global-status-text');
    const iconBg = document.getElementById('status-icon-bg');
    const badge = document.getElementById('status-badge');
    const phText = document.getElementById('ph-text');
    const confBar = document.getElementById('confidence-bar');

    let iconHtml = '';

    if (hsv.h >= 50 && hsv.h <= 65) {
        globalText.innerText = "Luka Sehat / Normal";
        globalText.className = "text-header-sm font-bold text-normal";
        iconBg.className = "status-icon-bg bg-normal";
        iconHtml = '<i data-lucide="check-circle"></i>';
        badge.innerText = "NOMINAL";
        badge.className = "status-badge badge-normal";
        confBar.className = "progress-bar bar-normal";
        confBar.style.width = "95%";
        phText.innerText = "pH < 6.5 (Asam)";

    } else if (hsv.h >= 30 && hsv.h < 50) {
        globalText.innerText = "Waspada Infeksi";
        globalText.className = "text-header-sm font-bold text-warning";
        iconBg.className = "status-icon-bg bg-warning";
        iconHtml = '<i data-lucide="alert-triangle"></i>';
        badge.innerText = "WARNING";
        badge.className = "status-badge badge-warning";
        confBar.className = "progress-bar bar-warning";
        confBar.style.width = "60%";
        phText.innerText = "pH 6.6 - 7.4 (Transisi)";

    } else {
        globalText.innerText = "Infeksi Terdeteksi";
        globalText.className = "text-header-sm font-bold text-critical";
        iconBg.className = "status-icon-bg bg-critical";
        iconHtml = '<i data-lucide="activity"></i>';
        badge.innerText = "CRITICAL";
        badge.className = "status-badge badge-critical";
        confBar.className = "progress-bar bar-critical";
        confBar.style.width = "85%";
        phText.innerText = "pH > 7.5 (Basa Kuat)";
    }

    iconBg.innerHTML = iconHtml;
    lucide.createIcons();
}
