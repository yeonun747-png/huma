import { execSync } from 'child_process';

export async function mergeWithFFmpeg(params: {
  videoPath: string;
  audioPath: string | null;
  bgmPath: string;
  outputPath: string;
  bgmVolume?: number;
}): Promise<string> {
  const { videoPath, audioPath, bgmPath, outputPath, bgmVolume = 0.25 } = params;

  const inputs = [`-i "${videoPath}"`, `-i "${bgmPath}"`];
  let filterComplex = '';
  let mapFlags = '';

  if (audioPath) {
    inputs.push(`-i "${audioPath}"`);
    filterComplex = `-filter_complex "[1:a]volume=${bgmVolume}[bgm];[2:a][bgm]amix=inputs=2:duration=first[aout]"`;
    mapFlags = '-map 0:v -map "[aout]"';
  } else {
    filterComplex = `-filter_complex "[1:a]volume=${bgmVolume}[aout]"`;
    mapFlags = '-map 0:v -map "[aout]"';
  }

  const cmd = [
    'ffmpeg -y',
    ...inputs,
    filterComplex,
    mapFlags,
    '-c:v copy -c:a aac -b:a 128k',
    `"${outputPath}"`,
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });
  return outputPath;
}
