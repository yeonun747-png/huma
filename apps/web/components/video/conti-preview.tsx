'use client';

import type { ContiPreviewData } from '@/lib/video-content-status';

export function ContiPreview({ conti }: { conti: ContiPreviewData }) {
  return (
    <div className="space-y-3 text-[11px]">
      {conti.scenarioSummary ? (
        <div>
          <div className="mb-1 font-semibold text-huma-t2">시나리오 요약</div>
          <p className="whitespace-pre-wrap text-huma-t3">{conti.scenarioSummary}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px] text-huma-t3">
        {conti.location ? <div>장소: {conti.location}</div> : null}
        {conti.lighting ? <div>조명: {conti.lighting}</div> : null}
        {conti.timeOfDay ? <div>시간: {conti.timeOfDay}</div> : null}
        {conti.cutType ? <div>컷: {conti.cutType}</div> : null}
        {conti.duration ? <div>길이: {conti.duration}s</div> : null}
      </div>

      {conti.characters?.length ? (
        <div>
          <div className="mb-1 font-semibold text-huma-t2">등장인물</div>
          <ul className="space-y-1">
            {conti.characters.map((c, i) => (
              <li key={i} className="rounded border border-huma-bdr bg-huma-bg2 px-2 py-1">
                <span className="font-semibold text-huma-t">{c.label}</span>
                <span className="ml-2 text-huma-t3">
                  {[c.age, c.gender, c.hair, c.outfit].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conti.shots?.length ? (
        <div>
          <div className="mb-1 font-semibold text-huma-t2">샷 구성</div>
          <div className="max-h-[240px] overflow-y-auto rounded border border-huma-bdr">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-huma-bg3 text-huma-t3">
                <tr>
                  <th className="p-1 text-left">#</th>
                  <th className="p-1 text-left">시간</th>
                  <th className="p-1 text-left">카메라</th>
                  <th className="p-1 text-left">액션 / 대사</th>
                </tr>
              </thead>
              <tbody>
                {conti.shots.map((s, i) => (
                  <tr key={i} className="border-t border-huma-bdr2 align-top">
                    <td className="p-1">{s.shotNumber ?? i + 1}</td>
                    <td className="p-1 whitespace-nowrap">
                      {s.startSec != null && s.endSec != null ? `${s.startSec}–${s.endSec}s` : '—'}
                    </td>
                    <td className="p-1">{s.camera ?? '—'}</td>
                    <td className="p-1">
                      {s.action ? <div>{s.action}</div> : null}
                      {s.dialogue ? <div className="text-huma-acc">「{s.dialogue}」</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {conti.evolinkPrompt ? (
        <details className="rounded border border-huma-bdr bg-huma-bg2 p-2">
          <summary className="cursor-pointer font-mono text-[10px] text-huma-t3">
            EvoLink 프롬프트 ({conti.evolinkPrompt.length}자)
          </summary>
          <pre className="mt-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap text-[10px] text-huma-t3">
            {conti.evolinkPrompt}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
