import sharp from 'sharp';
import axios from 'axios';
import { getSetting } from '../../lib/settings.js';
import { gaussianRandom, randomBetween } from '../../lib/utils.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { pickExifDevice } from '../../lib/exif-device-pool.js';

/** UI 슬라이더 noise_pct(0~5) = 실제 강도 % */
export function resolveNoiseSigma(noisePct: number): number {
  const pct = Math.min(5, Math.max(0, Number(noisePct) || 0));
  if (pct <= 0) return 0;
  return (pct / 100) * 255 * 0.35;
}

/** http(s) URL이면 다운로드, 로컬 파일 경로면 그대로 읽는다 */
async function loadImageBytes(src: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(src)) {
    const { data } = await axios.get(src, { responseType: 'arraybuffer' });
    return Buffer.from(data);
  }
  return readFile(src);
}

async function applySubtleGaussianNoise(img: sharp.Sharp, noisePct: number): Promise<sharp.Sharp> {
  const sigma = resolveNoiseSigma(noisePct);
  if (sigma <= 0) return img;

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);

  for (let i = 0; i < out.length; i += 1) {
    if (info.channels === 4 && i % 4 === 3) continue;
    const next = out[i]! + gaussianRandom(0, sigma);
    out[i] = Math.max(0, Math.min(255, Math.round(next)));
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}

export async function uniquifyImageFromUrl(url: string): Promise<string> {
  const data = await loadImageBytes(url);
  const config = await getSetting('image_engine', {
    noise_pct: 0.3,
    jpeg_quality_range: [90, 96],
    exif_randomize: true,
    gps_randomize: true,
  });

  const quality = randomBetween(config.jpeg_quality_range[0], config.jpeg_quality_range[1]);
  let img = sharp(data);
  img = await applySubtleGaussianNoise(img, config.noise_pct);

  const outPath = join(tmpdir(), `img_${Date.now()}_${randomBetween(1000, 9999)}.jpg`);
  await img.jpeg({ quality, mozjpeg: true }).toFile(outPath);

  if (config.exif_randomize) {
    await injectRandomExif(outPath);
  }

  return outPath;
}

async function injectRandomExif(filePath: string) {
  try {
    const device = pickExifDevice(randomBetween(0, 9999));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const piexif = (await import('piexifjs')).default as {
      load: (d: string) => Record<string, Record<number, unknown>>;
      dump: (o: Record<string, unknown>) => string;
      insert: (b: string, d: string) => string;
      ImageIFD: { Make: number; Model: number; Software: number };
      GPSIFD: { GPSLatitude: number; GPSLongitude: number };
    };
    const jpegData = await readFile(filePath);
    const dataStr = jpegData.toString('binary');
    const exifObj = piexif.load(dataStr);
    exifObj['0th'][piexif.ImageIFD.Make] = device.make;
    exifObj['0th'][piexif.ImageIFD.Model] = device.model;
    if (piexif.ImageIFD.Software != null) {
      exifObj['0th'][piexif.ImageIFD.Software] = device.make === 'Apple' ? '16.6' : '14.0';
    }
    exifObj['GPS'][piexif.GPSIFD.GPSLatitude] = [
      [randomBetween(33, 38), 1],
      [randomBetween(0, 59), 1],
      [randomBetween(0, 59), 1],
    ];
    exifObj['GPS'][piexif.GPSIFD.GPSLongitude] = [
      [randomBetween(124, 130), 1],
      [randomBetween(0, 59), 1],
      [randomBetween(0, 59), 1],
    ];
    const exifBytes = piexif.dump(exifObj);
    const newData = piexif.insert(exifBytes, dataStr);
    await writeFile(filePath, Buffer.from(newData, 'binary'));
  } catch {
    // EXIF 실패 시 원본 유지
  }
}
