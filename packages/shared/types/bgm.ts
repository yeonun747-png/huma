import type { Workspace } from './account';

export interface HumaBgmLibrary {
  id: string;
  title: string;
  file_path: string;
  file_url: string;
  duration_sec: number;
  mood: string[];
  genre: string[];
  tempo?: string;
  energy?: string;
  bpm?: number;
  keywords: string[];
  workspace_fit: Workspace[];
  platform_fit: string[];
  source?: string;
  license?: string;
  use_count: number;
  created_at: string;
}

export interface BgmPixabayItem {
  id: number;
  title: string;
  duration: number;
  previewUrl: string;
  downloadUrl: string;
  tags: string[];
  likes: number;
}

export interface BgmListResponse {
  category: string;
  items: BgmPixabayItem[];
}
