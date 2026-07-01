import { execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { SubtitleStyle, VideoConti, VideoContiShot } from './types.js';

/** ASS PrimaryColour — &H00BBGGRR */
const ASS_COLOR_A = '&H00FFFFFF';
const ASS_COLOR_B = '&H0000FFFF';
const ASS_FONT_SIZE = 42;
/** 하단 정렬(alignment 2) — MarginV가 작을수록 화면에서 위 */
const SUBTITLE_LINES_OFFSET_UP = 1;
const SUBTITLE_LINE_HEIGHT_PX = Math.round(ASS_FONT_SIZE * 1.2);

function subtitleMarginV(baseFromBottom: number): number {
  return baseFromBottom + SUBTITLE_LINES_OFFSET_UP * SUBTITLE_LINE_HEIGHT_PX;
}

export type DialogueSegment = { speaker: 'A' | 'B' | null; text: string };

function normalizeDialogueQuotes(dialogue: string): string {
  return dialogue.trim().replace(/[「『]/g, '"').replace(/[」』]/g, '"');
}

function cleanQuotedFragment(text: string): string {
  return text.trim().replace(/^["']+|["']+$/g, '').trim();
}

/** A: / B: 구간별 파싱 — 한 샷에 복수 화자 대사 가능 */
export function parseDialogueSegments(dialogue: string): DialogueSegment[] {
  const normalized = normalizeDialogueQuotes(dialogue);
  if (!normalized) return [];

  const chunks = normalized.split(/(?=[AB]\s*:)/i).filter((c) => c.trim());
  const segments: DialogueSegment[] = [];

  for (const chunk of chunks) {
    const m = chunk.match(/^([AB])\s*:\s*(.*)$/is);
    if (m) {
      const text = cleanQuotedFragment(m[2]!);
      if (text) segments.push({ speaker: m[1]!.toUpperCase() as 'A' | 'B', text });
      continue;
    }
    const text = cleanQuotedFragment(chunk);
    if (text) segments.push({ speaker: null, text });
  }

  return segments;
}

/** 화면 자막용 — 한 줄에서 A:/B: 라벨·따옴표 제거 */
function stripSpeakerLabelLine(line: string): string {
  const segments = parseDialogueSegments(line);
  if (segments.length) return segments.map((s) => s.text).join(' ').trim();
  return cleanQuotedFragment(normalizeDialogueQuotes(line).replace(/(?:^|\s)[AB]\s*:\s*/gi, ' '));
}

/** 화면 자막용 — 모든 A:/B: 라벨·따옴표 제거 (줄바꿈 유지) */
export function stripSpeakerLabel(dialogue: string): string {
  const lines = dialogue.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1) {
    return lines.map((line) => stripSpeakerLabelLine(line)).filter(Boolean).join('\n');
  }
  return stripSpeakerLabelLine(dialogue);
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
}

function assNewlines(text: string): string {
  return escapeAssText(text).replace(/\n/g, '\\N');
}

/** 한 물리 줄(엔터로 구분) ASS 텍스트 — 같은 줄에 A/B 복수 대사는 인라인 색상 */
function formatAssDialogueLine(line: string): {
  text: string;
  style: 'Default' | 'SpeakerA' | 'SpeakerB';
} {
  const segments = parseDialogueSegments(line);
  if (!segments.length) return { text: '', style: 'Default' };

  if (segments.length === 1) {
    const seg = segments[0]!;
    if (seg.speaker === 'B') return { text: assNewlines(seg.text), style: 'SpeakerB' };
    if (seg.speaker === 'A') return { text: assNewlines(seg.text), style: 'SpeakerA' };
    return { text: assNewlines(seg.text), style: 'Default' };
  }

  const parts = segments.map((seg, i) => {
    const prefix = i > 0 ? ' ' : '';
    const color = seg.speaker === 'B' ? ASS_COLOR_B : ASS_COLOR_A;
    return `${prefix}{\\c${color}&}${assNewlines(seg.text)}`;
  });
  return { text: parts.join(''), style: 'Default' };
}

function assColoredLine(f: { text: string; style: 'Default' | 'SpeakerA' | 'SpeakerB' }): string {
  if (f.style === 'SpeakerB') return `{\\c${ASS_COLOR_B}&}${f.text}`;
  if (f.style === 'SpeakerA') return `{\\c${ASS_COLOR_A}&}${f.text}`;
  return f.text;
}

export function formatAssDialogueText(dialogue: string): {
  text: string;
  style: 'Default' | 'SpeakerA' | 'SpeakerB';
} {
  const normalized = dialogue.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const formatted = lines.map(formatAssDialogueLine);
  if (!formatted.length) return { text: '', style: 'Default' };
  if (formatted.length === 1) return formatted[0]!;

  return {
    text: formatted.map(assColoredLine).join('\\N'),
    style: 'Default',
  };
}

function positionToAss(style: SubtitleStyle): { alignment: number; marginV: number } {
  // ASS alignment 2 = 하단 가운데 (가로는 항상 중앙)
  switch (style.position) {
    case 'lower_third':
      return { alignment: 2, marginV: subtitleMarginV(80) };
    case 'center_lower':
      return { alignment: 2, marginV: subtitleMarginV(200) };
    case 'bottom_left':
    case 'bottom_center':
    default:
      return { alignment: 2, marginV: subtitleMarginV(50) };
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

export interface SubtitlePreviewLine {
  text: string;
  speakerStyle: 'A' | 'B' | 'default';
}

export interface SubtitlePreviewEvent {
  shotNumber: number;
  startSec: number;
  endSec: number;
  text: string;
  speakerStyle: 'A' | 'B' | 'default';
  lines: SubtitlePreviewLine[];
}

function previewLinesForDialogue(dialogue: string): SubtitlePreviewLine[] {
  return dialogue
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const { style } = formatAssDialogueLine(line);
      const speakerStyle: SubtitlePreviewLine['speakerStyle'] =
        style === 'SpeakerB' ? 'B' : style === 'SpeakerA' ? 'A' : 'default';
      return { text: stripSpeakerLabelLine(line), speakerStyle };
    })
    .filter((l) => l.text.length > 0);
}

export function buildSubtitlePreviewEvents(conti: VideoConti, style: SubtitleStyle): SubtitlePreviewEvent[] {
  const totalDuration =
    conti.shots.at(-1)?.endSec ?? conti.duration ?? conti.shots.reduce((m, s) => Math.max(m, s.endSec), 0);

  const dialogueShots = conti.shots.filter((s) => stripSpeakerLabel(s.dialogue ?? '').length > 0);
  const events: SubtitlePreviewEvent[] = [];

  for (let i = 0; i < dialogueShots.length; i++) {
    const shot = dialogueShots[i]!;
    const nextStart = dialogueShots[i + 1]?.startSec ?? totalDuration;
    const window = subtitleWindow(shot, style, totalDuration, nextStart);
    if (!window) continue;

    const { style: assStyle } = formatAssDialogueText(shot.dialogue!);
    const lines = previewLinesForDialogue(shot.dialogue!);
    const displayText = stripSpeakerLabel(shot.dialogue!);
    if (!displayText) continue;

    const speakerStyle: SubtitlePreviewEvent['speakerStyle'] =
      assStyle === 'SpeakerB' ? 'B' : assStyle === 'SpeakerA' ? 'A' : 'default';

    events.push({
      shotNumber: shot.shotNumber,
      startSec: window.startSec,
      endSec: window.endSec,
      text: displayText,
      speakerStyle,
      lines,
    });
  }

  return events;
}

function splitPhysicalDialogueLines(dialogue: string): string[] {
  return dialogue
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function buildAssDialogueRows(params: {
  dialogue: string;
  style: SubtitleStyle;
}): Array<{ assStyle: 'Default' | 'SpeakerA' | 'SpeakerB'; marginV: number; text: string }> {
  const pos = positionToAss(params.style);
  const physicalLines = splitPhysicalDialogueLines(params.dialogue);

  if (physicalLines.length <= 1) {
    const { text, style: assStyle } = formatAssDialogueText(params.dialogue);
    if (!text) return [];
    return [{ assStyle, marginV: pos.marginV, text }];
  }

  const lineHeight = SUBTITLE_LINE_HEIGHT_PX;
  return physicalLines.map((line, index) => {
    const formatted = formatAssDialogueLine(line);
    // 입력 순서대로 위→아래: 첫 줄(index 0)이 더 작은 MarginV(화면 상단)
    const marginV = pos.marginV + index * lineHeight;
    return { assStyle: formatted.style, marginV, text: formatted.text };
  });
}
export function buildAssContent(conti: VideoConti, style: SubtitleStyle): string {
  const pos = positionToAss(style);
  const box = boxStyleToAss(style);
  const fontName = style.font.replace(/[^\w\s]/g, '') || 'Noto Sans KR';

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${ASS_FONT_SIZE},${ASS_COLOR_A},&H000000FF,&H00000000,${box.backColour},-1,0,0,0,100,100,0,0,${box.borderStyle},${box.outline},${box.shadow},${pos.alignment},20,20,${pos.marginV},1
Style: SpeakerA,${fontName},${ASS_FONT_SIZE},${ASS_COLOR_A},&H000000FF,&H00000000,${box.backColour},-1,0,0,0,100,100,0,0,${box.borderStyle},${box.outline},${box.shadow},${pos.alignment},20,20,${pos.marginV},1
Style: SpeakerB,${fontName},${ASS_FONT_SIZE},${ASS_COLOR_B},&H000000FF,&H00000000,${box.backColour},-1,0,0,0,100,100,0,0,${box.borderStyle},${box.outline},${box.shadow},${pos.alignment},20,20,${pos.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = buildSubtitlePreviewEvents(conti, style);
  const lines: string[] = [header];

  for (const event of events) {
    const dialogueRaw =
      conti.shots.find((s) => s.shotNumber === event.shotNumber)?.dialogue ?? event.text;
    const rows = buildAssDialogueRows({ dialogue: dialogueRaw, style });
    for (const row of rows) {
      if (!row.text) continue;
      lines.push(
        `Dialogue: 0,${secToAssTime(event.startSec)},${secToAssTime(event.endSec)},${row.assStyle},,0,0,${row.marginV},,${row.text}`,
      );
    }
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
