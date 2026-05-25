'use client';

import { MGrid, MPanel } from '@/components/mockup/primitives';

export function BgmLibraryView() {
  return (
    <div className="animate-fadeIn">
      <MGrid cols={1}>
        <MPanel title="오디오 정책 (v3.12)">
          <div className="space-y-4 text-sm text-huma-t2">
            <p>
              v3.12 기획서에 따라 <strong className="text-huma-t">별도 BGM 라이브러리</strong>는 제거되었습니다.
            </p>
            <ul className="list-inside list-disc space-y-2 text-[12px] text-huma-t3">
              <li>기본: <span className="font-mono text-huma-acc">Kling 3.0</span> 영상 내장 오디오 사용</li>
              <li>선택: TTS 나레이션 + 립싱크 (Eleven v3 등)</li>
              <li>Pixabay · Supabase · Suno BGM 연동 없음</li>
            </ul>
            <p className="text-[11px] text-huma-t3">
              영상 생성은 <span className="text-huma-t">영상 파이프라인</span> 메뉴에서 진행하세요.
            </p>
          </div>
        </MPanel>
      </MGrid>
    </div>
  );
}
