/** JPEG EXIF Make/Model — 실제 소비자 기기 풀 (HUMA 등 자동화 흔적 금지) */

export type ExifDevice = { make: string; model: string };

export const EXIF_DEVICE_POOL: ExifDevice[] = [
  { make: 'samsung', model: 'SM-S911N' },
  { make: 'samsung', model: 'SM-S921N' },
  { make: 'samsung', model: 'SM-S926N' },
  { make: 'samsung', model: 'SM-G991N' },
  { make: 'samsung', model: 'SM-A546N' },
  { make: 'Apple', model: 'iPhone 14 Pro' },
  { make: 'Apple', model: 'iPhone 15' },
  { make: 'Apple', model: 'iPhone 15 Pro' },
  { make: 'Apple', model: 'iPhone 13' },
  { make: 'LG Electronics', model: 'LM-G900N' },
  { make: 'Canon', model: 'Canon EOS R50' },
  { make: 'Canon', model: 'Canon EOS M50 Mark II' },
  { make: 'SONY', model: 'ILCE-6400' },
  { make: 'NIKON CORPORATION', model: 'NIKON Z fc' },
  { make: 'Google', model: 'Pixel 8 Pro' },
  { make: 'Google', model: 'Pixel 7a' },
];

export function pickExifDevice(seed?: number): ExifDevice {
  const idx = seed != null
    ? Math.abs(seed) % EXIF_DEVICE_POOL.length
    : Math.floor(Math.random() * EXIF_DEVICE_POOL.length);
  return EXIF_DEVICE_POOL[idx]!;
}
