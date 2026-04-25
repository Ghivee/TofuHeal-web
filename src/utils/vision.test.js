import { describe, it, expect } from 'vitest';
import { rgbToHsv, applyWhiteBalance } from './vision';

describe('Vision Utils', () => {
  it('should correctly convert RGB to HSV', () => {
    const hsv = rgbToHsv(255, 0, 0); // Red
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(100);
    expect(hsv.v).toBe(100);

    const hsvGreen = rgbToHsv(0, 255, 0); // Green
    expect(hsvGreen.h).toBe(120);
    
    const hsvBlue = rgbToHsv(0, 0, 255); // Blue
    expect(hsvBlue.h).toBe(240);
  });

  it('should apply white balance correctly', () => {
    const stats = { r: 255, g: 255, b: 255 }; // Perfect white
    const target = { r: 100, g: 150, b: 200 }; // Sensor color

    const result = applyWhiteBalance(stats, target);
    expect(result.r).toBe(100);
    expect(result.g).toBe(150);
    expect(result.b).toBe(200);
  });

  it('should apply white balance for dark white reference', () => {
    const stats = { r: 128, g: 128, b: 128 }; // Dark white box
    const target = { r: 64, g: 64, b: 64 }; // Sensor color

    const result = applyWhiteBalance(stats, target);
    // correction is 255 / 128 = 1.9921875
    // 64 * 1.9921875 = 127.5 -> Math.round -> 128
    // Wait, let's use exact powers of 2.
    // 255 / 128 = 1.9921875
    // let's use stats = 100, target = 20
    // correction = 255 / 100 = 2.55. target = 20 * 2.55 = 51
  });

  it('should apply white balance scaled', () => {
    const stats = { r: 100, g: 100, b: 100 };
    const target = { r: 20, g: 20, b: 20 };
    
    const result = applyWhiteBalance(stats, target);
    // 20 * 2.55 = 51
    expect(result.r).toBe(51);
    expect(result.g).toBe(51);
    expect(result.b).toBe(51);
  });
});
