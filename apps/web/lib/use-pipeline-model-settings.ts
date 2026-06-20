'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  DEFAULT_PIPELINE_VIDEO_QUALITY,
  DEFAULT_VIDEO_MODEL,
  type ImagenPipelineChoice,
  type PipelineVideoQuality,
  normalizeImagenPipelineChoice,
  normalizePipelineVideoDuration,
  normalizePipelineVideoQuality,
  normalizePipelineVideoSelect,
  pipelineVideoFromSelect,
} from '@/lib/higgsfield-models';

type ImagePatch = { img?: ImagenPipelineChoice; haiku?: boolean };
type VideoPatch = { durationSec?: number; quality?: PipelineVideoQuality };

export function usePipelineModelSettings() {
  const [loaded, setLoaded] = useState(false);
  const [imgChoice, setImgChoice] = useState<ImagenPipelineChoice>('auto');
  const [haikuAuto, setHaikuAuto] = useState(true);
  const [videoDurationSec, setVideoDurationSec] = useState(15);
  const [videoQuality, setVideoQuality] = useState<PipelineVideoQuality>(DEFAULT_PIPELINE_VIDEO_QUALITY);

  const stateRef = useRef({ imgChoice, haikuAuto, videoDurationSec, videoQuality });
  stateRef.current = { imgChoice, haikuAuto, videoDurationSec, videoQuality };

  useEffect(() => {
    void api
      .getSetting('higgsfield')
      .catch(() => ({}))
      .then((hg) => {
        const settings = hg as Record<string, unknown>;
        const savedDur = Number(settings.video_duration_sec);
        setVideoDurationSec(normalizePipelineVideoDuration(savedDur));
        const savedQ = String(settings.video_quality ?? settings.default_video_resolution ?? '720p');
        setVideoQuality(normalizePipelineVideoQuality(savedQ));
        normalizePipelineVideoSelect(String(settings.default_video_model ?? DEFAULT_VIDEO_MODEL));

        const savedImg = String(settings.default_image_model ?? 'auto');
        if (savedImg === 'auto' || !savedImg.startsWith('imagen-')) {
          setHaikuAuto(true);
          setImgChoice('auto');
        } else {
          setHaikuAuto(false);
          setImgChoice(normalizeImagenPipelineChoice(savedImg));
        }
        setLoaded(true);
      });
  }, []);

  const saveImageSettings = useCallback(async (patch: ImagePatch = {}) => {
    if (!loaded) return;
    const next = {
      img: patch.img ?? stateRef.current.imgChoice,
      haiku: patch.haiku ?? stateRef.current.haikuAuto,
    };
    const hg = (await api.getSetting('higgsfield').catch(() => ({}))) as Record<string, unknown>;
    const imageModel = next.haiku || next.img === 'auto' ? 'auto' : next.img;
    await api.updateSetting('higgsfield', {
      ...hg,
      default_image_model: imageModel,
    });
  }, [loaded]);

  const saveVideoSettings = useCallback(async (patch: VideoPatch = {}) => {
    if (!loaded) return;
    const next = {
      durationSec: patch.durationSec ?? stateRef.current.videoDurationSec,
      quality: patch.quality ?? stateRef.current.videoQuality,
    };
    const hg = (await api.getSetting('higgsfield').catch(() => ({}))) as Record<string, unknown>;
    await api.updateSetting('higgsfield', {
      ...hg,
      default_video_model: pipelineVideoFromSelect(DEFAULT_VIDEO_MODEL),
      video_duration_sec: next.durationSec,
      video_quality: next.quality,
      default_video_resolution: next.quality,
    });
  }, [loaded]);

  return {
    loaded,
    imgChoice,
    haikuAuto,
    videoDurationSec,
    videoQuality,
    setImgChoice,
    setHaikuAuto,
    setVideoDurationSec,
    setVideoQuality,
    saveImageSettings,
    saveVideoSettings,
  };
}
