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
    // slight delay to allow smooth animation
    setTimeout(() => {
        showEl.classList.remove('hide');
        showEl.classList.add('show');
    }, 100);
}

btnOpenCamera.addEventListener('click', async () => {
    toggleView(cameraView, dashboardView);

    try {
        streamData = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        videoFeed.srcObject = streamData;
        
        // Wait till metadata is loaded to calculate SVG sizes
        videoFeed.onloadedmetadata = () => {
            updateSvgStencil();
            setupResizeObserver();
        };

    } catch (err) {
        showToast("Akses kamera ditolak. Pastikan memberikan izin kamera pada browser.");
        closeCamera();
    }
});

btnCloseCamera.addEventListener('click', closeCamera);

function closeCamera() {
    if (streamData) streamData.getTracks().forEach(track => track.stop());
    toggleView(dashboardView, cameraView);
    if(resizeObserver) resizeObserver.disconnect();
    isProcessing = false;
}

// Dynamically scale SVG boxes based on the container size
function updateSvgStencil() {
    const wrapper = document.querySelector('.camera-wrapper');
    if (!wrapper) return;
    
    // Screen dimensions (simulated or real phone bounds)
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    
    // 4:3 Outer Box (White Balance Area) - Takes 80% screen width
    const box43_W = w * 0.8;
    const box43_H = box43_W * (3/4);
    
    // 3:2 Sensor Box - Inside the 4:3 area
    const box32_W = box43_W * 0.45;
    const box32_H = box32_W * (2/3);
    
    const cX = w / 2;
    const cY = h / 2;
    
    const setRect = (id, width, height) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.setAttribute('x', cX - width/2);
        el.setAttribute('y', cY - height/2);
        el.setAttribute('width', width);
        el.setAttribute('height', height);
    };
    
    setRect('mask-rect-43', box43_W, box43_H);
    setRect('outline-43', box43_W, box43_H);
    setRect('outline-32', box32_W, box32_H);
    
    const t43 = document.getElementById('text-43');
    if(t43) { t43.setAttribute('x', cX); t43.setAttribute('y', cY - box43_H/2 - 12); }
    
    const t32 = document.getElementById('text-32');
    if(t32) { t32.setAttribute('x', cX); t32.setAttribute('y', cY - box32_H/2 - 12); }
    
    // Save to window for coordinate mapping during sampling
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

    if(!window.boxParams) {
        showToast("Mohon tunggu kamera fokus.");
        isProcessing = false;
        return;
    }

    // Ekstrak parameter dari SVG sizing
    const { box43_W, box43_H, box32_W, box32_H, cX, cY, w, h } = window.boxParams;

    // Buat shadow canvas (ukuran sama persis dengan layar user)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = w; 
    canvas.height = h;

    // Duplikasi simulasi `object-fit: cover` JS manual
    const vW = videoFeed.videoWidth;
    const vH = videoFeed.videoHeight;
    const scale = Math.max(w / vW, h / vH);
    const drawW = vW * scale;
    const drawH = vH * scale;
    const startX = (w - drawW) / 2;
    const startY = (h - drawH) / 2;

    // Draw video ke kanvas persis seperti apa yang dilihat user
    ctx.drawImage(videoFeed, startX, startY, drawW, drawH);

    // Dapatkan data pixel KHUSUS pada batas 4:3 (Kotak Putih keseluruhan)
    const left43 = cX - box43_W / 2;
    const top43 = cY - box43_H / 2;
    
    // Agar lebih optimal, extract hanya area bounding box 4:3
    const imgData = ctx.getImageData(left43, top43, box43_W, box43_H).data;

    let whitePixels = [];
    let sensorPixels = [];

    // Local coordinates (relative to the imgData array)
    const left32_local = (cX - box32_W / 2) - left43;
    const right32_local = (cX + box32_W / 2) - left43;
    const top32_local = (cY - box32_H / 2) - top43;
    const bottom32_local = (cY + box32_H / 2) - top43;

    for (let y = 0; y < box43_H; y++) {
        for (let x = 0; x < box43_W; x++) {
            const i = (Math.floor(y) * Math.floor(box43_W) + Math.floor(x)) * 4;
            const r = imgData[i];
            const g = imgData[i+1];
            const b = imgData[i+2];

            // Cek apakah pixel berada tepat di area Sensor (3:2)
            const isInside32 = (x >= left32_local && x <= right32_local && y >= top32_local && y <= bottom32_local);

            if (isInside32) {
                sensorPixels.push({ r, g, b });
            } else {
                whitePixels.push({ r, g, b });
            }
        }
    }

    // Helper: Hitung Mean Group
    const getStats = (pixelArr) => {
        let sumR = 0, sumG = 0, sumB = 0;
        for(let p of pixelArr) { sumR += p.r; sumG += p.g; sumB += p.b; }
        const count = pixelArr.length;
        const mean = { r: sumR/count, g: sumG/count, b: sumB/count };
        
        let vr=0, vg=0, vb=0;
        for(let p of pixelArr) { 
            vr += Math.pow(p.r - mean.r, 2); 
            vg += Math.pow(p.g - mean.g, 2); 
            vb += Math.pow(p.b - mean.b, 2); 
        }
        // std dev noise measure
        const noise = Math.sqrt((vr+vg+vb) / (count*3));
        return { 
            r: Math.round(mean.r), 
            g: Math.round(mean.g), 
            b: Math.round(mean.b), 
            noise: noise 
        };
    };

    const whiteStats = getStats(whitePixels);
    const sensorStats = getStats(sensorPixels);

    // --- ERROR HANDLING TINGKAT LANJUT ---

    // 1. Cek Kebocoran Background (Noise check)
    // Tweak tolerances based on physical limits
    const maxAllowedNoise = 40; 
    if (whiteStats.noise > maxAllowedNoise || sensorStats.noise > maxAllowedNoise) {
        showToast("PENYEJAJARAN GAGAL: Objek tidak sejajar. Terdapat kebocoran objek luar di area putih.");
        isProcessing = false;
        return;
    }

    // 2. Cek Realitas Kotak Putih (Gelap)
    if (whiteStats.r < 80 && whiteStats.g < 80 && whiteStats.b < 80) {
        showToast("PENCAHAYAAN GAGAL: Kotak putih sangat gelap. Cari tempat yang lebih terang.");
        isProcessing = false;
        return;
    }

    // --- KALIBRASI WHITE BALANCE ---
    // Koreksi mencari warna putih murni (255)
    const correction = {
        r: 255 / (whiteStats.r || 1),
        g: 255 / (whiteStats.g || 1),
        b: 255 / (whiteStats.b || 1)
    };

    // Aplikasikan koreksi putih ke area sensor
    const calibratedRGB = {
        r: Math.min(255, Math.round(sensorStats.r * correction.r)),
        g: Math.min(255, Math.round(sensorStats.g * correction.g)),
        b: Math.min(255, Math.round(sensorStats.b * correction.b))
    };

    // --- KONVERSI HSV & VALIDASI SENSOR KURKUMIN ---
    const hsv = rgbToHsv(calibratedRGB.r, calibratedRGB.g, calibratedRGB.b);

    if (hsv.v < 20) {
        showToast("ANALISIS GAGAL: Area terlalu gelap. Perbaiki pencahayaan.");
        isProcessing = false; return;
    }
    if (hsv.s < 20) {
        showToast("ANALISIS GAGAL: Warna memudar putih. Sensor kurkumin cacat / tidak terdeteksi jelas.");
        isProcessing = false; return;
    }
    // Paten Tofu-Heal Hue Indicator Limits (Jangan ubah nilai 65, 30, 50 ini)
    if (hsv.h > 65 && hsv.h < 330) {
        showToast(`ANALISIS GAGAL: Warna memudar (${hsv.h}°). Diluar spektrum kurkumin.`);
        isProcessing = false; return;
    }

    // --- SUKSES ---
    updateDashboard(calibratedRGB, hsv);
    sendDataToServer(calibratedRGB, hsv);
    closeCamera();
});

// --- MODULE 5: LOCAL STORAGE & NETWORK ---
async function sendDataToServer(rgb, hsv) {
    const phEstimation = document.getElementById('ph-text').innerText;
    const status = document.getElementById('status-badge').innerText;
    
    // Save to LocalStorage
    saveToHistory({
        ph: phEstimation,
        status: status,
        date: new Date().toLocaleString('id-ID', { hour:'2-digit', minute:'2-digit', day:'numeric', month:'short' }),
        rgb: rgb
    });

    try {
        await fetch('process.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rgb: rgb, hsv: hsv, ph_estimation: phEstimation })
        });
    } catch (err) {
        console.warn("Backend PHP fallback (Aman di lingkungan static).");
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
    if (status === 'NOMINAL') return 'badge-normal';
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

    // Tampilkan RGB Preview color
    cleanRgbBox.style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

    // Reset ikon air agar warna tidak tembus
    const dropIcon = cleanRgbBox.querySelector('.drop-icon');
    if (dropIcon) {
        // Kontras adaptif jika background gelap
        const luminance = 0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b;
        dropIcon.style.color = luminance > 128 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
    }

    const globalText = document.getElementById('global-status-text');
    const iconBg = document.getElementById('status-icon-bg');
    const badge = document.getElementById('status-badge');
    const phText = document.getElementById('ph-text');
    const confBar = document.getElementById('confidence-bar');

    let iconHtml = '';

    // Paten Tofu-Heal Hue Indicator Limits
    if (hsv.h >= 50 && hsv.h <= 65) {
        globalText.innerText = "Luka Sehat / Normal";
        globalText.className = "text-header-sm font-bold text-normal";
        iconBg.className = "status-icon-bg bg-normal";
        iconHtml = '<i data-lucide="check-circle"></i>';
        badge.innerText = "NOMINAL";
        badge.className = "status-badge badge-normal";
        confBar.className = "progress-bar bar-normal";
        confBar.style.width = "95%";
        phText.innerText = "pH 4.5 - 6.5 (Asam)";

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
        // Critical is < 30 or > 65
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
