import { execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { SubtitleStyle, VideoConti } from './types.js';

function positionToAss(style: SubtitleStyle): { alignment: number; marginV: number } {
  switch (style.position) {
    case 'bottom_left':
      return { alignment: 1, marginV: 40 };
    case 'lower_third':
      return { alignment: 2, marginV: 80 };
    case 'center_lower':
      return { alignment: 2, marginV: 200 };
    default:
      return { alignment: 2, marginV: 50 };
  }
}

function boxStyleToAss(style: SubtitleStyle): { borderStyle: number; outline: number; backColour: string } {
  switch (style.boxStyle) {
    case 'solid_dark':
      return { borderStyle: 3, outline: 0, backColour: '&H80000000' };
    case 'outline_only':
      return { borderStyle: 1, outline: 3, backColour: '&H00000000' };
    case 'rounded_pill':
      return { borderStyle: 3, outline: 0, backColour: '&H60000000' };
    default:
      return { borderStyle: 3, outline: 0, backColour: '&H40000000' };
  }
}

function secToAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildAssContent(conti: VideoConti, style: SubtitleStyle): string {
  const pos = positionToAss(style);
  const box = boxStyleToAss(style);
  const fontName = style.font.replace(/[^\w\s]/g, '') || 'Noto Sans KR';

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},42,&H00FFFFFF,&H000000FF,&H00000000,${box.backColour},-1,0,0,0,100,100,0,0,${box.borderStyle},${box.outline},0,${pos.alignment},20,20,${pos.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [header];
  for (const shot of conti.shots) {
    if (!shot.dialogue?.trim()) continue;
    const start = secToAssTime(shot.startSec);
    const end = secToAssTime(Math.max(shot.endSec, shot.startSec + 0.8));
    const text = shot.dialogue.replace(/\n/g, '\\N');
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return lines.join('\n');
}

export async function burnSubtitles(params: {
  inputVideoPath: string;
  outputVideoPath: string;
  conti: VideoConti;
  style: SubtitleStyle;
}): Promise<string> {
  const tmpDir = join(process.cwd(), 'tmp', 'subtitles');
  await mkdir(tmpDir, { recursive: true });
  const assPath = join(tmpDir, `subs_${Date.now()}.ass`);
  await writeFile(assPath, buildAssContent(params.conti, params.style), 'utf8');

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const cmd = [
    'ffmpeg -y',
    `-i "${params.inputVideoPath}"`,
    `-vf "ass='${assEscaped}'"`,
    '-c:a copy',
    `"${params.outputVideoPath}"`,
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });
  return params.outputVideoPath;
}
