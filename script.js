// --- MODULE 1: UI & DOM ELEMENTS ---
const dashboardView = document.getElementById('dashboard-view');
const cameraView = document.getElementById('camera-view');
const videoFeed = document.getElementById('camera-feed');
const btnOpenCamera = document.getElementById('btn-open-camera');
const btnCloseCamera = document.getElementById('btn-close-camera');
const btnCapture = document.getElementById('btn-capture');

let streamData = null;
let isProcessing = false;

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

// --- MODULE 2: CAMERA MANAGEMENT ---
btnOpenCamera.addEventListener('click', async () => {
    dashboardView.classList.add('hidden');
    cameraView.classList.remove('hidden');
    cameraView.classList.add('flex');

    try {
        streamData = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        videoFeed.srcObject = streamData;
    } catch (err) {
        showToast("Akses kamera ditolak. Pastikan memberikan izin kamera pada browser.");
        closeCamera();
    }
});

btnCloseCamera.addEventListener('click', closeCamera);

function closeCamera() {
    if (streamData) streamData.getTracks().forEach(track => track.stop());
    cameraView.classList.add('hidden');
    cameraView.classList.remove('flex');
    dashboardView.classList.remove('hidden');
    isProcessing = false;
}

// --- MODULE 3: COLORIMETRY & MATH ALGORITHMS ---

// FUNGSI BARU: Analisis Piksel Detail (Mencegah "Seuprit Warna")
function analyzePixels(pixels) {
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;

    // Tahap 1: Cari Rata-rata (Mean)
    for (let i = 0; i < pixels.length; i += 4) {
        rSum += pixels[i];
        gSum += pixels[i + 1];
        bSum += pixels[i + 2];
        count++;
    }

    const meanR = rSum / count;
    const meanG = gSum / count;
    const meanB = bSum / count;

    // Tahap 2: Cari Variansi (Tingkat Keseragaman Warna)
    let rVar = 0, gVar = 0, bVar = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        rVar += Math.pow(pixels[i] - meanR, 2);
        gVar += Math.pow(pixels[i + 1] - meanG, 2);
        bVar += Math.pow(pixels[i + 2] - meanB, 2);
    }

    // Hitung Standard Deviasi (Makin besar = makin banyak campuran warna)
    const stdDevR = Math.sqrt(rVar / count);
    const stdDevG = Math.sqrt(gVar / count);
    const stdDevB = Math.sqrt(bVar / count);
    const averageNoise = (stdDevR + stdDevG + stdDevB) / 3;

    return {
        r: Math.round(meanR),
        g: Math.round(meanG),
        b: Math.round(meanB),
        noise: averageNoise // Tingkat kebocoran background
    };
}

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

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = videoFeed.videoWidth;
    const height = videoFeed.videoHeight;
    canvas.width = width; canvas.height = height;
    ctx.drawImage(videoFeed, 0, 0, width, height);

    // Ekstraksi Koordinat Stensil
    const whiteBox = { x: Math.floor(width * 0.35), y: Math.floor(height * 0.20), w: Math.floor(width * 0.30), h: Math.floor(height * 0.06) };
    const sensorBox = { x: Math.floor(width * 0.30), y: Math.floor(height * 0.30), w: Math.floor(width * 0.40), h: Math.floor(height * 0.40) };

    const whiteData = ctx.getImageData(whiteBox.x, whiteBox.y, whiteBox.w, whiteBox.h);
    const sensorData = ctx.getImageData(sensorBox.x, sensorBox.y, sensorBox.w, sensorBox.h);

    // Analisis Mendalam Piksel
    const whiteStats = analyzePixels(whiteData.data);
    const sensorStats = analyzePixels(sensorData.data);

    // --- ERROR HANDLING TINGKAT LANJUT ---

    // 1. Cek Kebocoran Background (Noise/Variance Check)
    const maxAllowedNoise = 30; // Ambang batas toleransi campuran warna
    if (whiteStats.noise > maxAllowedNoise || sensorStats.noise > maxAllowedNoise) {
        showToast("PENGAMBILAN GAGAL: Objek tidak memenuhi bingkai sepenuhnya. Terdapat kebocoran background.");
        isProcessing = false;
        return;
    }

    // 2. Cek Realitas Kotak Putih
    if (whiteStats.r < 80 && whiteStats.g < 80 && whiteStats.b < 80) {
        showToast("PENGAMBILAN GAGAL: Kotak kalibrasi putih tidak terdeteksi atau cahaya terlalu gelap.");
        isProcessing = false;
        return;
    }

    // --- KALIBRASI WHITE BALANCE ---
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

    // --- KONVERSI HSV & VALIDASI SENSOR KURKUMIN ---
    const hsv = rgbToHsv(calibratedRGB.r, calibratedRGB.g, calibratedRGB.b);

    if (hsv.v < 20) {
        showToast("PENGAMBILAN GAGAL: Area terlalu gelap. Perbaiki pencahayaan.");
        isProcessing = false; return;
    }
    if (hsv.s < 20) {
        showToast("PENGAMBILAN GAGAL: Warna terlalu pudar/putih. Sensor kurkumin tidak terbaca jelas.");
        isProcessing = false; return;
    }
    if (hsv.h > 65 && hsv.h < 330) {
        showToast(`PENGAMBILAN GAGAL: Warna terdeteksi (${hsv.h}°) bukan rentang warna indikator Tofu-Heal.`);
        isProcessing = false; return;
    }

    // --- SUKSES ---
    updateDashboard(calibratedRGB, hsv);
    sendDataToServer(calibratedRGB, hsv); // Kirim data ke PHP
    closeCamera();
});

// --- MODULE 5: SERVER & LOCAL STORAGE ---
async function sendDataToServer(rgb, hsv) {
    const phEstimation = document.getElementById('ph-text').innerText;
    const status = document.getElementById('status-badge').innerText;
    
    // Save to LocalStorage (Always works on GitHub Pages)
    saveToHistory({
        ph: phEstimation,
        status: status,
        date: new Date().toLocaleString('id-ID'),
        rgb: rgb
    });

    try {
        const response = await fetch('process.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rgb: rgb,
                hsv: hsv,
                ph_estimation: phEstimation
            })
        });
        const result = await response.json();
    } catch (err) {
        console.warn("PHP Server tidak terdeteksi (Normal untuk GitHub Pages). Data disimpan di lokal.");
    }
}

function saveToHistory(item) {
    let history = JSON.parse(localStorage.getItem('tofu_history') || '[]');
    history.unshift(item); // Add to beginning
    history = history.slice(0, 5); // Keep last 5
    localStorage.setItem('tofu_history', JSON.stringify(history));
    loadHistory();
}

function loadHistory() {
    const historyList = document.getElementById('history-list');
    const history = JSON.parse(localStorage.getItem('tofu_history') || '[]');
    
    if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-state">Belum ada riwayat pemindaian</div>';
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
    if (confirm('Hapus semua riwayat?')) {
        localStorage.removeItem('tofu_history');
        loadHistory();
    }
}

// --- MODULE 6: UPDATE DASHBOARD UI ---
function updateDashboard(rgb, hsv) {
    document.getElementById('tile-r').innerText = rgb.r;
    document.getElementById('tile-g').innerText = rgb.g;
    document.getElementById('tile-b').innerText = rgb.b;

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
        globalText.innerText = "Infeksi Terdeteksi";
        globalText.className = "text-header-sm font-bold text-critical";
        iconBg.className = "status-icon-bg bg-critical";
        iconHtml = '<i data-lucide="activity"></i>';
        badge.innerText = "CRITICAL";
        badge.className = "status-badge badge-critical";
        confBar.className = "progress-bar bar-critical";
        confBar.style.width = "85%";
        phText.innerText = "pH 7.5 - 9.0+ (Basa)";
    }

    iconBg.innerHTML = iconHtml;
    lucide.createIcons();
}
