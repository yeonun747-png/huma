export interface HumaVideoContentHistory {
  id: string;
  account_id: string;
  workspace: string;
  status: 'generating' | 'completed' | 'failed' | string;
  relationship_axis?: string | null;
  situation_axis?: string | null;
  location_keyword?: string | null;
  time_of_day?: string | null;
  emotion_curve?: string | null;
  hook_type?: string | null;
  scenario_summary?: string | null;
  similarity_score?: number | null;
  cut_type?: string | null;
  duration?: number | null;
  character_used?: string | null;
  caption_youtube?: string | null;
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
  error_message?: string | null;
  created_at: string;
}

export interface VideoPersonaConfig {
  relationshipAxes: string[];
  situationAxes?: string[];
  emotionCurves: string[];
  hookTypes: string[];
  hookTypeMaxWeight?: Record<string, number>;
  cutTypeRule?: string;
  shotStructure?: string;
  serviceConstraints: string;
  extraPromptNotes?: string;
}
