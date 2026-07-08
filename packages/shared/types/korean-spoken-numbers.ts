/** TTS 대본용 — dialogue 아라비아 숫자 → 한국어 발음 (화면 자막은 subtitle.ts에서 숫자로 복원) */

const SINO = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] as const;

const NATIVE_BEFORE_COUNTER = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'] as const;

const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'] as const;

type CounterKind = 'native' | 'sino' | 'hour';

const COUNTER_KIND: Record<string, CounterKind> = {
  개: 'native',
  명: 'native',
  마리: 'native',
  살: 'native',
  잔: 'native',
  병: 'native',
  송이: 'native',
  대: 'native',
  마디: 'native',
  벌: 'native',
  켤레: 'native',
  그루: 'native',
  채: 'native',
  가지: 'native',
  곳: 'native',
  주치: 'native',
  주째: 'native',
  주: 'native',
  시: 'hour',
  월: 'sino',
  년: 'sino',
  일: 'sino',
  분: 'sino',
  초: 'sino',
  층: 'sino',
  번: 'sino',
  호: 'sino',
  회: 'sino',
  점: 'sino',
  등: 'sino',
  위: 'sino',
  원: 'sino',
  '%': 'sino',
  퍼센트: 'sino',
};

function parseNumericToken(raw: string): number | null {
  const normalized = raw.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function toSinoKoreanNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '영';
  if (n < 0) return `마이너스${toSinoKoreanNumber(-n)}`;

  let remaining = Math.floor(n);
  let out = '';

  const append = (value: number, unit: string, omitOne = true) => {
    if (value <= 0) return;
    if (value === 1 && omitOne) {
      out += unit;
      return;
    }
    out += SINO[value]! + unit;
  };

  const eok = Math.floor(remaining / 100_000_000);
  remaining %= 100_000_000;
  const man = Math.floor(remaining / 10_000);
  remaining %= 10_000;

  if (eok > 0) append(eok, '억', false);
  if (man > 0) append(man, '만', false);

  const cheon = Math.floor(remaining / 1000);
  remaining %= 1000;
  const baek = Math.floor(remaining / 100);
  remaining %= 100;
  const sip = Math.floor(remaining / 10);
  const il = remaining % 10;

  append(cheon, '천');
  append(baek, '백');
  append(sip, '십');
  if (il > 0) out += SINO[il]!;

  return out || '영';
}

function toNativeBeforeCounter(n: number): string {
  if (n <= 0) return toSinoKoreanNumber(n);
  if (n < 10) return NATIVE_BEFORE_COUNTER[n]!;
  if (n >= 100) return toSinoKoreanNumber(n);

  const ten = Math.floor(n / 10);
  const one = n % 10;
  const tenStr = NATIVE_TENS[ten]!;
  if (one === 0) {
    return ten === 2 ? '스무' : tenStr;
  }
  return tenStr + NATIVE_BEFORE_COUNTER[one]!;
}

function toHourKorean(n: number): string {
  if (n <= 0 || n >= 100) return toSinoKoreanNumber(n) + '시';
  if (n < 10) return `${NATIVE_BEFORE_COUNTER[n]!}시`;
  if (n < 20) return `열${NATIVE_BEFORE_COUNTER[n - 10]!}시`;
  const ten = Math.floor(n / 10);
  const one = n % 10;
  const tenStr = NATIVE_TENS[ten]!;
  if (one === 0) return `${ten === 2 ? '스무' : tenStr}시`;
  return `${tenStr}${NATIVE_BEFORE_COUNTER[one]!}시`;
}

function convertNumberWithCounter(n: number, counter: string): string {
  const kind = COUNTER_KIND[counter] ?? 'sino';
  if (counter === '%') return `${toSinoKoreanNumber(n)}퍼센트`;
  if (counter === '원') return `${toSinoKoreanNumber(n)}원`;
  if (kind === 'hour') return toHourKorean(n);
  if (kind === 'native') return `${toNativeBeforeCounter(n)}${counter}`;
  return `${toSinoKoreanNumber(n)}${counter}`;
}

function convertDecimalNumber(raw: string): string {
  const [intPart, fracPart] = raw.split('.');
  const intN = parseNumericToken(intPart ?? '');
  if (intN == null) return raw;
  const intSpoken = toSinoKoreanNumber(intN);
  if (!fracPart) return intSpoken;
  const fracSpoken = [...fracPart].map((d) => SINO[Number(d)] ?? d).join('');
  return `${intSpoken}점${fracSpoken}`;
}

function convertPlainNumber(n: number): string {
  if (Number.isInteger(n) && n >= 0 && n <= 99) return toNativeBeforeCounter(n);
  return toSinoKoreanNumber(n);
}

/** dialogue·내레이션 — 아라비아 숫자를 한국어 발음으로 치환 */
export function convertSpokenKoreanNumbers(text: string): string {
  if (!text || !/\d/.test(text)) return text;

  let out = text.replace(/(\d{1,2}):(\d{2})/g, (_m, hRaw: string, mRaw: string) => {
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return _m;
    return `${toHourKorean(h).replace(/시$/, '')}시 ${toSinoKoreanNumber(m)}분`;
  });

  out = out.replace(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(개|명|마리|살|시|분|초|월|년|일|층|번|호|회|원|%|퍼센트|점|대|벌|켤레|그루|채|잔|병|마디|송이|가지|곳|위|등|주치|주째|주)/g,
    (match, numRaw: string, counter: string) => {
      const n = parseNumericToken(numRaw);
      if (n == null) return match;
      if (numRaw.includes('.')) return `${convertDecimalNumber(numRaw)}${counter === '%' ? '' : counter}`;
      return convertNumberWithCounter(Math.floor(n), counter);
    },
  );

  out = out.replace(/(\d+(?:,\d{3})*(?:\.\d+)?)(?![0-9:%/])/g, (match, numRaw: string) => {
    const n = parseNumericToken(numRaw);
    if (n == null) return match;
    if (numRaw.includes('.')) return convertDecimalNumber(numRaw);
    return convertPlainNumber(Math.floor(n));
  });

  return out;
}

export function buildDialogueSpokenNumberRule(): string {
  return (
    'dialogue(대본)의 숫자는 아라비아 숫자(0-9) 대신 **한국어 발음 그대로** 한글로 쓴다 — TTS·음성용. ' +
    '예: 7월→칠월, 7개→일곱개, 12시→열두시, 48번→사십팔번, 5000원→오천원, 3명→세명. ' +
    '화면 자막은 시스템이 숫자(7월, 7개 등)로 표시한다. action·camera·타임라인 초는 숫자 유지 가능.'
  );
}

const SINO_DIGITS: Record<string, number> = {
  영: 0,
  공: 0,
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
};

const SORTED_COUNTERS = Object.keys(COUNTER_KIND).sort((a, b) => b.length - a.length);

let nativeSpokenFormsCache: Array<{ text: string; value: number }> | null = null;

function nativeSpokenForms(): Array<{ text: string; value: number }> {
  if (nativeSpokenFormsCache) return nativeSpokenFormsCache;
  const seen = new Set<string>();
  const forms: Array<{ text: string; value: number }> = [];
  for (let n = 1; n <= 99; n++) {
    const spoken = toNativeBeforeCounter(n);
    if (spoken && !seen.has(spoken)) {
      seen.add(spoken);
      forms.push({ text: spoken, value: n });
    }
  }
  forms.sort((a, b) => b.text.length - a.text.length);
  nativeSpokenFormsCache = forms;
  return forms;
}

function parseSinoFromStart(text: string): { value: number; length: number } | null {
  let i = 0;
  let total = 0;
  let section = 0;
  let number = 0;
  let any = false;

  while (i < text.length) {
    const c = text[i]!;
    if (c in SINO_DIGITS) {
      number = SINO_DIGITS[c]!;
      any = true;
      i++;
      continue;
    }
    if (c === '십') {
      section += (number || 1) * 10;
      number = 0;
      any = true;
      i++;
      continue;
    }
    if (c === '백') {
      section += (number || 1) * 100;
      number = 0;
      any = true;
      i++;
      continue;
    }
    if (c === '천') {
      section += (number || 1) * 1000;
      number = 0;
      any = true;
      i++;
      continue;
    }
    if (c === '만') {
      section += number;
      total += (section || 1) * 10_000;
      section = 0;
      number = 0;
      any = true;
      i++;
      continue;
    }
    if (c === '억') {
      section += number;
      total += (section || 1) * 100_000_000;
      section = 0;
      number = 0;
      any = true;
      i++;
      continue;
    }
    break;
  }

  if (!any) return null;
  return { value: total + section + number, length: i };
}

function parseNativeFromStart(text: string): { value: number; length: number } | null {
  for (const { text: spoken, value } of nativeSpokenForms()) {
    if (text.startsWith(spoken)) return { value, length: spoken.length };
  }
  return null;
}

function matchClockTimeAt(rest: string): { text: string; length: number } | null {
  const hour = parseNativeFromStart(rest);
  if (!hour) return null;
  let pos = hour.length;
  if (!rest.slice(pos).startsWith('시')) return null;
  pos += 1;
  if (rest[pos] === ' ') pos += 1;
  const minute = parseSinoFromStart(rest.slice(pos));
  if (!minute) return null;
  pos += minute.length;
  if (!rest.slice(pos).startsWith('분')) return null;
  pos += 1;
  const mm = String(minute.value).padStart(2, '0');
  return { text: `${hour.value}:${mm}`, length: pos };
}

function matchNumberWithCounterAt(rest: string): { text: string; length: number } | null {
  const percent = parseSinoFromStart(rest);
  if (percent && rest.slice(percent.length).startsWith('퍼센트')) {
    return { text: `${percent.value}%`, length: percent.length + 3 };
  }

  for (const counter of SORTED_COUNTERS) {
    if (counter === '퍼센트' || counter === '%') continue;

    const kind = COUNTER_KIND[counter] ?? 'sino';
    if (kind === 'native' || kind === 'hour') {
      const parsed = parseNativeFromStart(rest);
      if (!parsed) continue;
      if (!rest.slice(parsed.length).startsWith(counter)) continue;
      return { text: `${parsed.value}${counter}`, length: parsed.length + counter.length };
    }

    const parsed = parseSinoFromStart(rest);
    if (!parsed) continue;
    if (!rest.slice(parsed.length).startsWith(counter)) continue;
    if (counter === '원') return { text: `${parsed.value}원`, length: parsed.length + 1 };
    return { text: `${parsed.value}${counter}`, length: parsed.length + counter.length };
  }

  return null;
}

/** 화면 자막용 — TTS 대본 한글 발음 숫자를 아라비아 숫자 표기로 복원 */
export function convertSpokenKoreanNumbersToDigits(text: string): string {
  if (!text || !/[일이삼사오육칠팔구영공십백천만억열스물서른마흔쉰예순일흔여든아흔하둘셋넷다섯여섯일곱여덟아홉한두세네]/.test(text)) {
    return text;
  }

  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const clock = matchClockTimeAt(rest);
    if (clock) {
      out += clock.text;
      i += clock.length;
      continue;
    }
    const withCounter = matchNumberWithCounterAt(rest);
    if (withCounter) {
      out += withCounter.text;
      i += withCounter.length;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}
