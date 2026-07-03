export type VideoContentStatus =
  | 'conti_generating'
  | 'conti_ready'
  | 'rendering'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'on_hold';

export interface HumaVideoContentHistory {
  id: string;
  account_id: string;
  workspace: string;
  status: VideoContentStatus | string;
  relationship_axis?: string | null;
  situation_axis?: string | null;
  location_keyword?: string | null;
  time_of_day?: string | null;
  emotion_curve?: string | null;
  hook_type?: string | null;
  hook_subtype?: string | null;
  punchline_idea?: string | null;
  used_product?: string | null;
  used_quiz_id?: string | null;
  scenario_summary?: string | null;
  conti_json?: Record<string, unknown> | null;
  similarity_score?: number | null;
  /** Haiku 별도 호출 유머 평가 — funny | dull */
  self_assessed_humor?: 'funny' | 'dull' | string | null;
  /** 유머 dull 재생성 시도 횟수 (0~2) */
  retry_count_for_humor?: number | null;
  cut_type?: string | null;
  duration?: number | null;
  character_used?: string | null;
  /** v3.55 — 콘티에 부여된 등장인물 이름 (A/B 라벨 제외) */
  character_names?: string[] | null;
  caption_youtube?: string | null;
  caption_youtube_title?: string | null;
  caption_youtube_description?: string | null;
  caption_tiktok?: string | null;
  caption_instagram?: string | null;
  caption_threads?: string | null;
  caption_x?: string | null;
  first_comment_threads?: string | null;
  first_comment_x?: string | null;
  uploaded_youtube?: boolean;
  uploaded_youtube_at?: string | null;
  uploaded_tiktok?: boolean;
  uploaded_tiktok_at?: string | null;
  uploaded_instagram?: boolean;
  uploaded_instagram_at?: string | null;
  uploaded_threads?: boolean;
  uploaded_threads_at?: string | null;
  uploaded_x?: boolean;
  uploaded_x_at?: string | null;
  video_file_path?: string | null;
  /** EvoLink 원본 (자막 없음) — 서버 로컬 경로 */
  source_video_path?: string | null;
  error_message?: string | null;
  /** conti_generating → 종료까지 경과 초 */
  conti_generation_sec?: number | null;
  /** 목록 API — 진행 중 작업 경과 기준 시각 (렌더는 videoRenderStartedAt) */
  progress_since_at?: string | null;
  created_at: string;
}

export interface VideoPersonaConfig {
  relationshipAxes: string[];
  situationAxes?: string[];
  emotionCurves: string[];
  hookTypes: string[];
  hookTypeMaxWeight?: Record<string, number>;
  /** 펀치라인 섹션의 서술형 원칙 — hookTypes 선택값과 분리 */
  hookTypeGuidance?: string;
  cutTypeRule?: string;
  shotStructure?: string;
  singleShotStructure?: string;
  serviceConstraints: string;
  extraPromptNotes?: string;
}
