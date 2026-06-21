import { describe, expect, it } from 'vitest';
import { extractLlmJsonBody, parseLlmJsonBlock, repairLooseJsonStringQuotes } from './llm-json.js';

describe('repairLooseJsonStringQuotes', () => {
  it('escapes inner double quotes in string values', () => {
    const broken = '{"dialogue": "A: \\"관운 막혔대\\" 라고 말했다"}';
    expect(JSON.parse(broken)).toBeTruthy();

    const loose = '{"dialogue": "A: "관운 막혔대" 라고 말했다"}';
    const repaired = repairLooseJsonStringQuotes(loose);
    expect(JSON.parse(repaired)).toEqual({ dialogue: 'A: "관운 막혔대" 라고 말했다' });
  });

  it('parses narrativeProse with Korean dialogue quotes', () => {
    const raw = `\`\`\`json
{"narrativeProse": "엄마가 "올해 관운 막혔대"라고 말했다. 아들은 조용히 공무원증을 꺼냈다.", "location": "거실"}
\`\`\``;
    const parsed = parseLlmJsonBlock(raw) as { narrativeProse: string; location: string };
    expect(parsed.location).toBe('거실');
    expect(parsed.narrativeProse).toContain('관운');
  });
});

describe('extractLlmJsonBody', () => {
  it('pulls object from fenced block', () => {
    const body = extractLlmJsonBody('```json\n{"ideas":["a","b"]}\n```');
    expect(JSON.parse(body)).toEqual({ ideas: ['a', 'b'] });
  });
});
