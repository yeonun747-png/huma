import sharp from 'sharp';
import axios from 'axios';
import { getSetting } from '../../lib/settings.js';
import { randomBetween } from '../../lib/utils.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { pickExifDevice } from '../../lib/exif-device-pool.js';

export async function uniquifyImageFromUrl(url: string): Promise<string> {
  const { data } = await axios.get(url, { responseType: 'arraybuffer' });
  const config = await getSetting('image_engine', {
    noise_pct: 0.8,
    jpeg_quality_range: [90, 96],
    exif_randomize: true,
    gps_randomize: true,
  });

  const quality = randomBetween(config.jpeg_quality_range[0], config.jpeg_quality_range[1]);
  let img = sharp(Buffer.from(data));

  if (config.noise_pct > 0) {
    const meta = await img.metadata();
    const w = meta.width ?? 800;
    const h = meta.height ?? 600;
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i++) {
      noise[i] = Math.floor(Math.random() * 256);
    }
    const noiseImg = await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
      .resize(w, h)
      .png()
      .toBuffer();
    img = sharp(await img.toBuffer()).composite([{ input: noiseImg, blend: 'overlay' }]);
  }

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
