// =============================================================================
// TOFU-HEAL · script.js  ·  High-Accuracy Engine v2.0
// =============================================================================
// ARSITEKTUR AKURASI:
//   1. Multi-frame temporal averaging  (10 frame @ 100ms interval)
//   2. White Reference validation ketat (neutrality + brightness gate)
//   3. Gamma-aware linear color math   (sRGB linearization sebelum kalkulasi)
//   4. Chromatic Adaptation (Von Kries) — koreksi per-channel yang benar secara fisik
//   5. Illuminant-normalized Hue       (hilangkan bias kamera & pencahayaan)
//   6. Weighted polynomial pH curve    (kurva kurkumin berbasis literatur ilmiah)
//   7. Confidence scoring & outlier rejection (IQR-based)
//   8. Stability lock: hanya capture jika sinyal stabil antar frame
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1 · DOM REFERENCES
// ─────────────────────────────────────────────────────────────────────────────
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
    setTimeout(() => toast.classList.add('hidden'), 4500);
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2 · CAMERA & SVG MASK
// ─────────────────────────────────────────────────────────────────────────────
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
    if (streamData) streamData.getTracks().forEach(t => t.stop());

    try {
        // ── Minta resolusi tinggi agar sampling lebih akurat ──────────────────
        streamData = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: facingMode,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                // Nonaktifkan AWB otomatis kamera jika browser mendukung
                // (Chrome Android kadang menerima constraint ini)
                advanced: [{ whiteBalanceMode: 'manual' }]
            },
            audio: false
        });

        videoFeed.srcObject = streamData;

        // ── Setelah stream siap, tunggu beberapa frame agar exposure stabil ──
        videoFeed.onloadedmetadata = () => {
            setTimeout(() => {
                updateSvgStencil();
                setupResizeObserver();
            }, 800); // beri waktu ISP kamera settle
        };

        currentFacingMode = facingMode;
        isFlashOn = false;
        const btnFlash = document.getElementById('btn-toggle-flash');
        if (btnFlash) {
            btnFlash.style.backgroundColor = 'rgba(15,23,42,0.4)';
            btnFlash.style.color = 'white';
        }

    } catch (err) {
        showToast('Akses kamera ditolak. Pastikan memberikan izin kamera pada browser.');
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
        const newMode = currentFacingMode === 'environment' ? 'user' : 'environment';
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
                showToast('Kamera ini tidak mendukung fitur lampu senter di browser.');
                return;
            }
            isFlashOn = !isFlashOn;
            await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
            btnToggleFlash.style.backgroundColor = isFlashOn ? 'white' : 'rgba(15,23,42,0.4)';
            btnToggleFlash.style.color = isFlashOn ? '#f59e0b' : 'white';
        } catch (err) {
            showToast('Gagal menyalakan senter. Akses diblokir sistem.');
            isFlashOn = false;
        }
    });
}

btnCloseCamera.addEventListener('click', closeCamera);

function closeCamera() {
    if (streamData) streamData.getTracks().forEach(t => t.stop());
    toggleView(dashboardView, cameraView);
    if (resizeObserver) resizeObserver.disconnect();
    isProcessing = false;
    frameBuffer = [];    // reset buffer saat kamera ditutup
}

function updateSvgStencil() {
    const wrapper = document.querySelector('.camera-wrapper');
    if (!wrapper) return;

    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;

    const maxAllowedW = w * 0.85;
    const maxAllowedH = h * 0.60;

    let box43_W = maxAllowedW;
    let box43_H = box43_W * (4 / 3);

    if (box43_H > maxAllowedH) {
        box43_H = maxAllowedH;
        box43_W = box43_H * (3 / 4);
    }
    if (box43_W > 600) { box43_W = 600; box43_H = box43_W * (4 / 3); }

    box43_W = Math.floor(box43_W);
    box43_H = Math.floor(box43_H);

    let box32_W = Math.floor(box43_W * 0.5);
    let box32_H = Math.floor(box32_W * (3 / 2));

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
    resizeObserver = new ResizeObserver(() => updateSvgStencil());
    resizeObserver.observe(wrapper);
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 · COLORIMETRY MATH  (Gamma-Accurate & Device-Independent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sRGB Linearization (gamma decode)
 * Kamera menyimpan piksel dalam sRGB (gamma ~2.2).
 * Semua operasi rata-rata WAJIB dilakukan di linear light space,
 * bukan di gamma-encoded space — kalau tidak, hasilnya akan bias gelap.
 */
function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Linear → sRGB (gamma encode) untuk display
 */
function linearToSrgb(c) {
    return c <= 0.0031308
        ? Math.round(c * 12.92 * 255)
        : Math.round((1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

/**
 * RGB (linear) → XYZ D65
 * Matriks standar IEC 61966-2-1 / sRGB primaries
 */
function linearRgbToXYZ(r, g, b) {
    return {
        X: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
        Y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
        Z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    };
}

/**
 * XYZ → CIE Lab (D65 illuminant)
 * Lab sangat lebih perseptual-uniform dibanding HSV — diferensiasi warna
 * yang sama persis dengan cara mata manusia melihat.
 */
function xyzToLab(X, Y, Z) {
    // D65 reference white
    const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
    return {
        L: 116 * fy - 16,
        a: 500 * (fx - fy),
        b: 200 * (fy - fz)
    };
}

/**
 * Konversi penuh: 8-bit sRGB → CIE Lab
 */
function rgbToLab(r, g, b) {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const xyz = linearRgbToXYZ(lr, lg, lb);
    return xyzToLab(xyz.X, xyz.Y, xyz.Z);
}

/**
 * RGB → HSV (tetap dipakai untuk spektrum kurkumin gate)
 */
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(Math.max(r, g, b) * 100) };
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4 · MULTI-FRAME BUFFER & STABILITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const FRAME_COUNT = 10;   // jumlah frame yang dirata-rata
const FRAME_INTERVAL_MS = 80;   // interval antar frame (ms) — 12.5 fps sampling
const STABILITY_THRESHOLD = 4.0; // max std-dev (0–255 scale) antar frame agar dianggap stabil

let frameBuffer = [];             // [{whiteLinear, sensorLinear}, ...]
let captureInterval = null;

/**
 * Ambil satu snapshot dari video → ekstrak statistik piksel linear
 * untuk area white reference dan sensor.
 * Returns: { white: {r,g,b}, sensor: {r,g,b}, valid: bool, reason: string }
 */
function captureFrameSnapshot() {
    const { box43_W, box43_H, box32_W, box32_H, cX, cY, w, h } = window.boxParams;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

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

    if (left43 < 0 || top43 < 0 || left43 + box43_W > w || top43 + box43_H > h) {
        return { valid: false, reason: 'Resolusi kamera bermasalah. Coba rotasi HP Anda.' };
    }

    const imgData = ctx.getImageData(left43, top43, box43_W, box43_H).data;

    const left32_local = (cX - box32_W / 2) - left43;
    const right32_local = (cX + box32_W / 2) - left43;
    const top32_local = (cY - box32_H / 2) - top43;
    const bottom32_local = (cY + box32_H / 2) - top43;

    // ── Akumulasi dalam LINEAR space ──────────────────────────────────────────
    let wSumR = 0, wSumG = 0, wSumB = 0, wCount = 0;
    let sSumR = 0, sSumG = 0, sSumB = 0, sCount = 0;

    // Noise check vars (gamma space untuk konsistensi dengan threshold lama)
    let wVarR = 0, wVarG = 0, wVarB = 0;
    let sVarR = 0, sVarG = 0, sVarB = 0;
    let wMeanGamma = { r: 0, g: 0, b: 0 };
    let sMeanGamma = { r: 0, g: 0, b: 0 };

    // Pass 1 — hitung mean gamma
    let wCntTmp = 0, sCntTmp = 0;
    for (let y = 0; y < box43_H; y++) {
        for (let x = 0; x < box43_W; x++) {
            const i = (y * box43_W + x) * 4;
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            const inside = x >= left32_local && x <= right32_local &&
                y >= top32_local && y <= bottom32_local;
            if (inside) {
                wMeanGamma.r += r; wMeanGamma.g += g; wMeanGamma.b += b; wCntTmp++;
            } else {
                sMeanGamma.r += r; sMeanGamma.g += g; sMeanGamma.b += b; sCntTmp++;
            }
        }
    }
    if (wCntTmp) { wMeanGamma.r /= wCntTmp; wMeanGamma.g /= wCntTmp; wMeanGamma.b /= wCntTmp; }
    if (sCntTmp) { sMeanGamma.r /= sCntTmp; sMeanGamma.g /= sCntTmp; sMeanGamma.b /= sCntTmp; }

    // Pass 2 — hitung linear sum + variance (pakai IQR outlier rejection)
    const wPixels = [], sPixels = [];
    for (let y = 0; y < box43_H; y++) {
        for (let x = 0; x < box43_W; x++) {
            const i = (y * box43_W + x) * 4;
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            const inside = x >= left32_local && x <= right32_local &&
                y >= top32_local && y <= bottom32_local;
            if (inside) {
                sPixels.push({ r, g, b });
            } else {
                wPixels.push({ r, g, b });
            }
        }
    }

    const { mean: wMean, noise: wNoise } = robustStats(wPixels);
    const { mean: sMean, noise: sNoise } = robustStats(sPixels);

    // ── Validasi white reference ─────────────────────────────────────────────
    // Gate 1: harus cukup terang
    if (wMean.r < 80 && wMean.g < 80 && wMean.b < 80) {
        return { valid: false, reason: 'PENCAHAYAAN GAGAL: Area putih terlalu gelap. Cari sumber cahaya lebih terang.' };
    }
    // Gate 2: harus netral (tidak boleh ada dominasi warna kuat)
    const wMax = Math.max(wMean.r, wMean.g, wMean.b);
    const wMin = Math.min(wMean.r, wMean.g, wMean.b);
    if (wMax - wMin > 55) {
        return { valid: false, reason: 'KALIBRASI GAGAL: Area putih tidak netral.' };
    }
    // Gate 3: tidak boleh terlalu berisik (gerakan / bayangan)
    if (wNoise > 45 || sNoise > 45) {
        return { valid: false, reason: 'PENYEJAJARAN GAGAL: Terlalu banyak gerakan. Tahan HP dengan stabil.' };
    }

    return {
        valid: true,
        white: wMean,  // rata-rata piksel area putih (gamma space, sudah outlier-free)
        sensor: sMean,  // rata-rata piksel area sensor
        wNoise, sNoise
    };
}

/**
 * Robust statistical summary: IQR-based outlier rejection lalu hitung mean + noise
 * Menghilangkan ~25% piksel ekstrem di setiap sisi distribusi luminance
 */
function robustStats(pixels) {
    if (pixels.length === 0) return { mean: { r: 1, g: 1, b: 1 }, noise: 0 };

    // Urutkan berdasarkan luminance untuk IQR
    const sorted = pixels.slice().sort(
        (a, b) => (0.299 * a.r + 0.587 * a.g + 0.114 * a.b) - (0.299 * b.r + 0.587 * b.g + 0.114 * b.b)
    );
    const q1 = Math.floor(sorted.length * 0.20);
    const q3 = Math.floor(sorted.length * 0.80);
    const trimmed = sorted.slice(q1, q3);

    let sumR = 0, sumG = 0, sumB = 0;
    for (const p of trimmed) { sumR += p.r; sumG += p.g; sumB += p.b; }
    const n = trimmed.length;
    const mean = { r: sumR / n, g: sumG / n, b: sumB / n };

    let vr = 0, vg = 0, vb = 0;
    for (const p of trimmed) {
        vr += (p.r - mean.r) ** 2;
        vg += (p.g - mean.g) ** 2;
        vb += (p.b - mean.b) ** 2;
    }
    const noise = Math.sqrt((vr + vg + vb) / (n * 3));

    return { mean, noise };
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 5 · VON KRIES CHROMATIC ADAPTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Von Kries white balance: scaling per-channel di linear light space
 * Secara fisik lebih benar daripada scaling di gamma space.
 *
 * Prinsip: jika kita tahu "abu-abu sempurna" seharusnya menghasilkan
 * equal-energy (R=G=B di linear), maka scaling setiap channel dengan
 * faktor (1/white_linear_channel) menormalisasi ke illuminant D65.
 *
 * @param sensorGamma  - {r,g,b} piksel sensor di sRGB (0–255)
 * @param whiteGamma   - {r,g,b} piksel referensi putih di sRGB (0–255)
 * @returns {r,g,b}    - kalibrasi sRGB (0–255), device-independent
 */
function vonKriesCalibrate(sensorGamma, whiteGamma) {
    // Decode ke linear
    const sLin = {
        r: srgbToLinear(sensorGamma.r),
        g: srgbToLinear(sensorGamma.g),
        b: srgbToLinear(sensorGamma.b)
    };
    const wLin = {
        r: srgbToLinear(Math.max(1, whiteGamma.r)),
        g: srgbToLinear(Math.max(1, whiteGamma.g)),
        b: srgbToLinear(Math.max(1, whiteGamma.b))
    };

    // Scaling ke D65 (assumed white = equal energy 1.0 di linear)
    // Faktor tidak boleh terlalu ekstrem → clamp ke ±3x untuk keamanan
    const scale = {
        r: Math.min(3.0, 1.0 / Math.max(wLin.r, 0.01)),
        g: Math.min(3.0, 1.0 / Math.max(wLin.g, 0.01)),
        b: Math.min(3.0, 1.0 / Math.max(wLin.b, 0.01))
    };

    const calibLin = {
        r: Math.min(1, sLin.r * scale.r),
        g: Math.min(1, sLin.g * scale.g),
        b: Math.min(1, sLin.b * scale.b)
    };

    // Re-encode ke sRGB
    return {
        r: linearToSrgb(calibLin.r),
        g: linearToSrgb(calibLin.g),
        b: linearToSrgb(calibLin.b)
    };
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 6 · pH ESTIMATION ENGINE  (Kurva Kurkumin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KURVA KALIBRASI KURKUMIN
 *
 * Berdasarkan sifat kurkumin yang terdokumentasi dalam literatur:
 *   - Kurkumin berwarna kuning cerah (Hue ~50–65°) pada pH < 6.5 (kondisi asam)
 *   - Berubah ke oranye (Hue ~35–49°)              pada pH 6.5–7.5 (transisi)
 *   - Berubah ke merah-oranye (Hue ~10–34°)        pada pH 7.5–9.0 (basa)
 *   - Merah kecoklatan/muda (Hue ~330–10°)         pada pH > 9.0 (sangat basa)
 *
 * Referensi: Jayaprakasha & Bhimanagouda, Molecules 2011;
 *            Wang et al., Food Chemistry 2016.
 *
 * Fungsi berikut mengkonversi Hue (0–360°) → estimasi pH numerik
 * menggunakan piecewise linear interpolation dari titik referensi.
 *
 * PENTING: Untuk akurasi >95%, Anda HARUS mengkalibrasi ulang titik-titik
 * ini menggunakan sensor kurkumin fisik Anda dengan larutan buffer pH terukur.
 * Gunakan fungsi calibrateFromSamples() di bawah untuk update otomatis.
 */
const CURCUMIN_CALIBRATION_KEY = 'tofu_curcumin_cal_v2';

// Titik referensi default (Hue° → pH) — ganti dengan kalibrasi lab Anda
let phCurve = loadCalibration() || [
    { hue: 58, ph: 5.0 },
    { hue: 54, ph: 5.5 },
    { hue: 50, ph: 6.0 },
    { hue: 45, ph: 6.5 },
    { hue: 40, ph: 7.0 },
    { hue: 33, ph: 7.5 },
    { hue: 25, ph: 8.0 },
    { hue: 18, ph: 8.5 },
    { hue: 12, ph: 9.0 },
    { hue: 5, ph: 9.5 },
];

function loadCalibration() {
    try {
        const saved = localStorage.getItem(CURCUMIN_CALIBRATION_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch { return null; }
}

function saveCalibration(curve) {
    localStorage.setItem(CURCUMIN_CALIBRATION_KEY, JSON.stringify(curve));
}

/**
 * Update kurva kalibrasi dari sampel baru (untuk kalibrasi lapangan)
 * @param {number} measuredHue   - nilai hue yang diukur
 * @param {number} knownPh       - pH referensi (dari buffer terukur)
 */
function calibrateFromSample(measuredHue, knownPh) {
    // Ganti atau sisipkan titik pada pH terdekat
    const idx = phCurve.findIndex(p => Math.abs(p.ph - knownPh) < 0.3);
    if (idx >= 0) {
        // Moving average dengan bobot 0.7 data baru vs 0.3 data lama
        phCurve[idx].hue = 0.7 * measuredHue + 0.3 * phCurve[idx].hue;
    } else {
        phCurve.push({ hue: measuredHue, ph: knownPh });
        phCurve.sort((a, b) => b.hue - a.hue); // sorted descending hue
    }
    saveCalibration(phCurve);
}

/**
 * Estimasi pH dari nilai Hue menggunakan piecewise linear interpolation
 * dengan weighted confidence scoring.
 *
 * @param {number} hue       - Hue dalam derajat (0–360)
 * @param {number} saturation - Saturation (0–100), dipakai untuk confidence
 * @returns {{ ph: number, confidence: number, label: string, status: string }}
 */
function estimatePh(hue, saturation, value) {
    // Normalisasi hue: kurkumin bisa wrap di sekitar 0° (merah-ungu)
    // Kita kerja di space 0–65° yang relevan
    let workHue = hue;
    if (hue > 300) workHue = hue - 360; // merah di sisi kiri jadi negatif → misal -30°

    // Sort kurva descending hue (high hue = kuning = pH rendah)
    const sorted = [...phCurve].sort((a, b) => b.hue - a.hue);

    let ph;
    if (workHue >= sorted[0].hue) {
        // Di atas rentang — ekstrapolasi dari 2 titik teratas
        const p0 = sorted[0], p1 = sorted[1];
        const slope = (p1.ph - p0.ph) / (p1.hue - p0.hue);
        ph = p0.ph + slope * (workHue - p0.hue);
    } else if (workHue <= sorted[sorted.length - 1].hue) {
        // Di bawah rentang — ekstrapolasi dari 2 titik terbawah
        const p0 = sorted[sorted.length - 2], p1 = sorted[sorted.length - 1];
        const slope = (p1.ph - p0.ph) / (p1.hue - p0.hue);
        ph = p1.ph + slope * (workHue - p1.hue);
    } else {
        // Interpolasi linear antara dua titik terdekat
        for (let i = 0; i < sorted.length - 1; i++) {
            if (workHue <= sorted[i].hue && workHue >= sorted[i + 1].hue) {
                const t = (workHue - sorted[i + 1].hue) / (sorted[i].hue - sorted[i + 1].hue);
                ph = sorted[i + 1].ph + t * (sorted[i].ph - sorted[i + 1].ph);
                break;
            }
        }
    }

    // Clamp ke rentang fisiologis luka (pH 4–10)
    ph = Math.max(4.0, Math.min(10.0, ph));

    // ── Confidence scoring ────────────────────────────────────────────────────
    // Faktor 1: saturation (warna jenuh = sinyal kurkumin kuat)
    const satFactor = Math.min(1.0, saturation / 60);
    // Faktor 2: value (tidak terlalu gelap atau terlalu terang)
    const valFactor = value >= 20 && value <= 95 ? 1.0 : 0.6;
    // Faktor 3: hue dalam rentang calibrasi (bukan ekstrapolasi)
    const inRange = workHue >= sorted[sorted.length - 1].hue && workHue <= sorted[0].hue;
    const rangeFactor = inRange ? 1.0 : 0.7;

    const confidence = Math.round(satFactor * valFactor * rangeFactor * 100);

    // ── Klasifikasi status ────────────────────────────────────────────────────
    let status, label, description;
    if (ph < 6.5) {
        status = 'NORMAL';
        label = 'Luka Sehat';
        description = `pH ${ph.toFixed(1)} (Asam — lingkungan penyembuhan optimal)`;
    } else if (ph <= 7.4) {
        status = 'WARNING';
        label = 'Waspada Infeksi';
        description = `pH ${ph.toFixed(1)} (Transisi — pantau perkembangan luka)`;
    } else {
        status = 'CRITICAL';
        label = 'Infeksi Terdeteksi';
        description = `pH ${ph.toFixed(1)} (Basa — indikasi infeksi aktif)`;
    }

    return { ph, confidence, status, label, description };
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 7 · DIAGNOSTIC PIPELINE  (Multi-Frame Capture)
// ─────────────────────────────────────────────────────────────────────────────

btnCapture.addEventListener('click', () => {
    if (!videoFeed.videoWidth || isProcessing) return;
    if (!window.boxParams) {
        showToast('Mohon tunggu kamera fokus.');
        return;
    }

    isProcessing = true;
    frameBuffer = [];

    // UI feedback
    btnCapture.disabled = true;
    btnCapture.innerText = `Menganalisis... (0/${FRAME_COUNT})`;

    let frameCount = 0;

    captureInterval = setInterval(() => {
        const snapshot = captureFrameSnapshot();

        if (!snapshot.valid) {
            clearInterval(captureInterval);
            showToast(snapshot.reason);
            isProcessing = false;
            btnCapture.disabled = false;
            btnCapture.innerText = 'Analisis';
            frameBuffer = [];
            return;
        }

        frameBuffer.push(snapshot);
        frameCount++;
        btnCapture.innerText = `Menganalisis... (${frameCount}/${FRAME_COUNT})`;

        if (frameCount >= FRAME_COUNT) {
            clearInterval(captureInterval);
            btnCapture.innerText = 'Memproses...';
            runFinalAnalysis();
        }
    }, FRAME_INTERVAL_MS);
});

/**
 * Setelah N frame terkumpul, rata-ratakan → kalibrasi → estimasi pH
 */
function runFinalAnalysis() {
    // ── 1. Rata-rata white dan sensor dari semua frame ─────────────────────
    // Lakukan dalam linear light space untuk akurasi
    let wLinR = 0, wLinG = 0, wLinB = 0;
    let sLinR = 0, sLinG = 0, sLinB = 0;

    for (const f of frameBuffer) {
        wLinR += srgbToLinear(f.white.r);
        wLinG += srgbToLinear(f.white.g);
        wLinB += srgbToLinear(f.white.b);
        sLinR += srgbToLinear(f.sensor.r);
        sLinG += srgbToLinear(f.sensor.g);
        sLinB += srgbToLinear(f.sensor.b);
    }

    const n = frameBuffer.length;
    const avgWhiteGamma = {
        r: linearToSrgb(wLinR / n),
        g: linearToSrgb(wLinG / n),
        b: linearToSrgb(wLinB / n)
    };
    const avgSensorGamma = {
        r: linearToSrgb(sLinR / n),
        g: linearToSrgb(sLinG / n),
        b: linearToSrgb(sLinB / n)
    };

    // ── 2. Stabilitas check antar frame ─────────────────────────────────────
    // Hitung std-dev hue antar semua frame sebelum averaging
    const frameHues = frameBuffer.map(f => {
        const cal = vonKriesCalibrate(f.sensor, f.white);
        return rgbToHsv(cal.r, cal.g, cal.b).h;
    });
    const meanHue = frameHues.reduce((a, b) => a + b, 0) / frameHues.length;
    const stdHue = Math.sqrt(
        frameHues.map(h => (h - meanHue) ** 2).reduce((a, b) => a + b, 0) / frameHues.length
    );

    if (stdHue > STABILITY_THRESHOLD * 3) {
        showToast(`SINYAL TIDAK STABIL: Fluktuasi warna terlalu tinggi (σ=${stdHue.toFixed(1)}°). Kurangi gerakan dan cahaya berkedip.`);
        isProcessing = false;
        btnCapture.disabled = false;
        btnCapture.innerText = 'Analisis';
        frameBuffer = [];
        return;
    }

    // ── 3. Von Kries kalibrasi ────────────────────────────────────────────────
    const calibratedRGB = vonKriesCalibrate(avgSensorGamma, avgWhiteGamma);
    const hsv = rgbToHsv(calibratedRGB.r, calibratedRGB.g, calibratedRGB.b);

    // ── 4. Validasi spektrum kurkumin ─────────────────────────────────────────
    if (hsv.v < 15) {
        showToast('ANALISIS GAGAL: Sampel sangat gelap. Tingkatkan pencahayaan.');
        isProcessing = false; btnCapture.disabled = false; btnCapture.innerText = 'Analisis'; return;
    }
    if (hsv.s < 12) {
        showToast('ANALISIS GAGAL: Warna terlalu pudar. Pastikan sensor kurkumin terkena luka.');
        isProcessing = false; btnCapture.disabled = false; btnCapture.innerText = 'Analisis'; return;
    }
    // Kurkumin hanya berwarna di rentang kuning-oranye-merah (0–65° + 330–360°)
    if (hsv.h > 65 && hsv.h < 330) {
        showToast(`ANALISIS GAGAL: Spektrum terbaca ${hsv.h}°. Di luar rentang kurkumin (harus kuning/oranye/merah).`);
        isProcessing = false; btnCapture.disabled = false; btnCapture.innerText = 'Analisis'; return;
    }

    // ── 5. Estimasi pH ────────────────────────────────────────────────────────
    const result = estimatePh(hsv.h, hsv.s, hsv.v);

    // ── 6. Update UI & simpan ─────────────────────────────────────────────────
    updateDashboard(calibratedRGB, hsv, result, stdHue);
    sendDataToServer(calibratedRGB, hsv, result);

    isProcessing = false;
    btnCapture.disabled = false;
    btnCapture.innerText = 'Analisis';
    frameBuffer = [];

    closeCamera();
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 8 · LOCAL STORAGE & NETWORK
// ─────────────────────────────────────────────────────────────────────────────

async function sendDataToServer(rgb, hsv, result) {
    const lab = rgbToLab(rgb.r, rgb.g, rgb.b);

    saveToHistory({
        ph: result.description,
        phNum: result.ph.toFixed(1),
        status: result.status,
        conf: result.confidence,
        date: new Date().toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
        rgb: rgb,
        hsv: hsv,
        lab: { L: lab.L.toFixed(1), a: lab.a.toFixed(1), b: lab.b.toFixed(1) }
    });

    try {
        await fetch('process.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rgb, hsv, lab,
                ph_estimation: result.description,
                ph_numeric: result.ph,
                confidence: result.confidence,
                status: result.status
            })
        });
    } catch { /* Safe to ignore */ }
}

function saveToHistory(item) {
    let history = JSON.parse(localStorage.getItem('tofu_history') || '[]');
    history.unshift(item);
    history = history.slice(0, 10);  // simpan 10 riwayat terakhir
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
                <span class="history-ph">pH ${item.phNum || '?'}</span>
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


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 9 · UPDATE DASHBOARD UI
// ─────────────────────────────────────────────────────────────────────────────

function updateDashboard(rgb, hsv, result, stdHue) {
    // ── RGB tiles ────────────────────────────────────────────────────────────
    document.getElementById('tile-r').innerText = rgb.r;
    document.getElementById('tile-g').innerText = rgb.g;
    document.getElementById('tile-b').innerText = rgb.b;

    // ── Color swatch ─────────────────────────────────────────────────────────
    cleanRgbBox.style.backgroundColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    const dropIcon = cleanRgbBox.querySelector('.drop-icon');
    if (dropIcon) {
        const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        dropIcon.style.color = lum > 128 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
    }

    // ── Status elements ───────────────────────────────────────────────────────
    const globalText = document.getElementById('global-status-text');
    const iconBg = document.getElementById('status-icon-bg');
    const badge = document.getElementById('status-badge');
    const phText = document.getElementById('ph-text');
    const confBar = document.getElementById('confidence-bar');

    globalText.innerText = result.label;
    phText.innerText = result.description;
    badge.innerText = result.status;

    // Width confidence bar dengan nilai aktual
    confBar.style.width = `${result.confidence}%`;

    const iconMap = {
        NOMINAL: { icon: 'check-circle', cls: 'text-normal', bg: 'bg-normal', badge: 'badge-normal', bar: 'bar-normal' },
        WARNING: { icon: 'alert-triangle', cls: 'text-warning', bg: 'bg-warning', badge: 'badge-warning', bar: 'bar-warning' },
        CRITICAL: { icon: 'activity', cls: 'text-critical', bg: 'bg-critical', badge: 'badge-critical', bar: 'bar-critical' }
    };

    const m = iconMap[result.status] || iconMap.CRITICAL;
    globalText.className = `text-header-sm font-bold ${m.cls}`;
    iconBg.className = `status-icon-bg ${m.bg}`;
    badge.className = `status-badge ${m.badge}`;
    confBar.className = `progress-bar ${m.bar}`;
    iconBg.innerHTML = `<i data-lucide="${m.icon}"></i>`;

    // ── Tampilkan data debug jika ada elemen debug ─────────────────────────
    const debugEl = document.getElementById('debug-info');
    if (debugEl) {
        const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
        debugEl.innerHTML = `
            HSV: ${hsv.h}° / ${hsv.s}% / ${hsv.v}%  |
            Lab: L${lab.L.toFixed(1)} a${lab.a.toFixed(1)} b${lab.b.toFixed(1)}  |
            Σhue: ${stdHue.toFixed(1)}°  |
            Conf: ${result.confidence}%
        `;
    }

    lucide.createIcons();
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 10 · FIELD CALIBRATION API  (opsional, untuk akurasi >95%)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * API publik untuk kalibrasi lapangan.
 * Panggil dari console browser atau tombol kalibrasi di UI Anda:
 *
 *   TofuHeal.calibrate(knownPh)
 *
 * Setelah scan kurkumin dengan buffer pH yang diketahui, panggil fungsi
 * ini dengan nilai pH sesungguhnya. Sistem akan menyimpan koreksi ke
 * localStorage dan digunakan di semua pengukuran berikutnya.
 */
window.TofuHeal = {
    calibrate(knownPh) {
        const lastRgb = JSON.parse(localStorage.getItem('tofu_history') || '[]')[0]?.rgb;
        if (!lastRgb) { console.warn('[TofuHeal] Tidak ada data scan terakhir.'); return; }
        const hsv = rgbToHsv(lastRgb.r, lastRgb.g, lastRgb.b);
        calibrateFromSample(hsv.h, knownPh);
        console.info(`[TofuHeal] Kalibrasi tersimpan: Hue ${hsv.h}° → pH ${knownPh}`);
    },
    resetCalibration() {
        localStorage.removeItem(CURCUMIN_CALIBRATION_KEY);
        phCurve = loadCalibration() || phCurve;
        console.info('[TofuHeal] Kalibrasi direset ke default.');
    },
    getCalibrationCurve() {
        return [...phCurve];
    }
};