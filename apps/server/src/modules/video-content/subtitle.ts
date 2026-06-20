import { execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { SubtitleStyle, VideoConti, VideoContiShot } from './types.js';

/** 화면 자막용 — A: "대사" 접두사·따옴표 제거 */
export function stripSpeakerLabel(dialogue: string): string {
  let text = dialogue.trim().replace(/[「」『』]/g, '');
  text = text.replace(/^[A-Z]\s*:\s*/i, '');
  text = text.replace(/^["'「]|["'」]$/g, '').trim();
  return text;
}

function positionToAss(style: SubtitleStyle): { alignment: number; marginV: number } {
  // ASS alignment 2 = 하단 가운데 (가로는 항상 중앙)
  switch (style.position) {
    case 'lower_third':
      return { alignment: 2, marginV: 80 };
    case 'center_lower':
      return { alignment: 2, marginV: 200 };
    case 'bottom_left':
    case 'bottom_center':
    default:
      return { alignment: 2, marginV: 50 };
  }
}

function boxStyleToAss(style: SubtitleStyle): {
  borderStyle: number;
  outline: number;
  shadow: number;
  backColour: string;
} {
  const outline = 5;
  switch (style.boxStyle) {
    case 'solid_dark':
      return { borderStyle: 4, outline, shadow: 1, backColour: '&H90000000' };
    case 'outline_only':
      return { borderStyle: 1, outline: 6, shadow: 2, backColour: '&H00000000' };
    case 'rounded_pill':
      return { borderStyle: 4, outline, shadow: 1, backColour: '&H70000000' };
    default:
      return { borderStyle: 1, outline, shadow: 2, backColour: '&H00000000' };
  }
}

function secToAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** 한국어 대사 길이 → 말하기·읽기에 필요한 최소 표시 시간(초) */
function estimateSpeechDurationSec(dialogue: string): number {
  const chars = stripSpeakerLabel(dialogue).replace(/\s/g, '').length;
  if (chars === 0) return 0.8;
  return Math.max(0.8, chars / 5.5 + 0.3);
}

function timingOffsets(style: SubtitleStyle): { startPad: number; endPad: number } {
  switch (style.timing) {
    case 'early':
      return { startPad: -0.12, endPad: 0.35 };
    case 'punchline_emphasis':
      return { startPad: 0.08, endPad: 0.45 };
    case 'fade_with_end':
      return { startPad: 0, endPad: -0.15 };
    default:
      return { startPad: 0.05, endPad: 0.25 };
  }
}

function subtitleWindow(
  shot: VideoContiShot,
  style: SubtitleStyle,
  totalDuration: number,
  nextDialogueStart: number,
): { startSec: number; endSec: number } | null {
  const raw = shot.dialogue?.trim();
  if (!raw) return null;

  const { startPad, endPad } = timingOffsets(style);
  const startSec = Math.max(0, shot.startSec + startPad);
  const speechEnd = shot.startSec + estimateSpeechDurationSec(raw);
  let endSec = Math.max(shot.endSec + endPad, speechEnd);
  endSec = Math.min(endSec, nextDialogueStart - 0.05, totalDuration);
  endSec = Math.max(endSec, startSec + 0.5);
  return { startSec, endSec };
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
Style: Default,${fontName},42,&H00FFFFFF,&H000000FF,&H00000000,${box.backColour},-1,0,0,0,100,100,0,0,${box.borderStyle},${box.outline},${box.shadow},${pos.alignment},20,20,${pos.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const totalDuration =
    conti.shots.at(-1)?.endSec ?? conti.duration ?? conti.shots.reduce((m, s) => Math.max(m, s.endSec), 0);

  const dialogueShots = conti.shots.filter((s) => stripSpeakerLabel(s.dialogue ?? '').length > 0);
  const lines: string[] = [header];

  for (let i = 0; i < dialogueShots.length; i++) {
    const shot = dialogueShots[i]!;
    const nextStart = dialogueShots[i + 1]?.startSec ?? totalDuration;
    const window = subtitleWindow(shot, style, totalDuration, nextStart);
    if (!window) continue;

    const text = stripSpeakerLabel(shot.dialogue!).replace(/\n/g, '\\N');
    if (!text) continue;

    lines.push(
      `Dialogue: 0,${secToAssTime(window.startSec)},${secToAssTime(window.endSec)},Default,,0,0,0,,${text}`,
    );
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
