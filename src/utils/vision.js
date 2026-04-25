/**
 * Logic for Health-Tech Vision Engineer - Tofu-Heal
 */

// 1. Detection of Blur using Laplacian Variance
export function calculateBlur(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    
    // Grayscale conversion
    for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = (data[i] + data[i + 1] + data[i + 2]) / 3;
    }

    // Laplacian Kernel
    const laplacian = [
        0,  1, 0,
        1, -4, 1,
        0,  1, 0
    ];

    let sum = 0;
    let sumSq = 0;
    const count = (width - 2) * (height - 2);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let res = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    res += gray[(y + ky) * width + (x + kx)] * laplacian[(ky + 1) * 3 + (kx + 1)];
                }
            }
            sum += res;
            sumSq += res * res;
        }
    }

    const variance = (sumSq / count) - (Math.pow(sum / count, 2));
    return variance; // Higher is sharper. Threshold around 10-20 depending on resolution.
}

// 2. Color Conversion HSV
export function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
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
    return { 
        h: Math.round(h * 360), 
        s: Math.round(s * 100), 
        v: Math.round(v * 100) 
    };
}

// 3. Auto-Tracking Logic (Nested 4:3 and 3:2 regions)
export function autoTrackRegions(ctx, width, height) {
    const step = 25;
    let bestCloth = { x: width * 0.2, y: height * 0.2, score: 0, w: 0, h: 0 };

    // Scan for White Cloth (4:3 aspect ratio)
    // We search for a large white-ish rectangle
    const clothW = Math.min(width * 0.8, height * 1.33 * 0.8);
    const clothH = clothW * 3 / 4;

    for (let y = 0; y < height - clothH; y += step) {
        for (let x = 0; x < width - clothW; x += step) {
            const data = ctx.getImageData(x, y, 40, 40).data; // Sample corners
            let whiteScore = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 180 && data[i+1] > 180 && data[i+2] > 180) whiteScore++;
            }
            if (whiteScore > bestCloth.score) {
                bestCloth = { x, y, score: whiteScore, w: clothW, h: clothH };
            }
        }
    }

    // Sensor is 3:2 center of cloth
    const sensorW = bestCloth.w * 0.6; // 60% of cloth width
    const sensorH = sensorW * 2 / 3;   // 3:2 aspect
    const sensorX = bestCloth.x + (bestCloth.w - sensorW) / 2;
    const sensorY = bestCloth.y + (bestCloth.h - sensorH) / 2;

    return {
        whiteBox: { x: bestCloth.x, y: bestCloth.y, w: bestCloth.w, h: bestCloth.h },
        sensorBox: { x: Math.floor(sensorX), y: Math.floor(sensorY), w: Math.floor(sensorW), h: Math.floor(sensorH) }
    };
}

// 4. White Balance Correction
export function applyWhiteBalance(stats, target) {
    const correction = {
        r: 255 / (stats.r || 1),
        g: 255 / (stats.g || 1),
        b: 255 / (stats.b || 1)
    };

    return {
        r: Math.min(255, Math.round(target.r * correction.r)),
        g: Math.min(255, Math.round(target.g * correction.g)),
        b: Math.min(255, Math.round(target.b * correction.b))
    };
}
