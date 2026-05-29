import axios from 'axios';
import fs from 'fs';

/** v3.21 §7-10-1 — Pinterest Video Pin (퀴즈오아시스 전용) */
export async function uploadPinterestVideoPin(params: {
  videoPath: string;
  title: string;
  description: string;
  linkUrl: string;
}): Promise<string | undefined> {
  const token = process.env.PINTEREST_ACCESS_TOKEN;
  const boardId = process.env.PINTEREST_BOARD_ID;
  if (!token || !boardId) {
    throw new Error('PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID 환경변수 필요');
  }

  const videoStat = fs.statSync(params.videoPath);
  const { data: media } = await axios.post(
    'https://api.pinterest.com/v5/media',
    { media_type: 'video' },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  await axios.put(media.upload_url, fs.readFileSync(params.videoPath), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(videoStat.size),
    },
  });

  for (let i = 0; i < 30; i++) {
    const { data: status } = await axios.get(`https://api.pinterest.com/v5/media/${media.media_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status.status === 'succeeded') break;
    if (status.status === 'failed') throw new Error('Pinterest 미디어 업로드 실패');
    await new Promise((r) => setTimeout(r, 2000));
  }

  const { data: pin } = await axios.post(
    'https://api.pinterest.com/v5/pins',
    {
      board_id: boardId,
      media_source: { source_type: 'video_id', cover_image_url: undefined, media_id: media.media_id },
      title: params.title.slice(0, 100),
      description: params.description.slice(0, 500),
      link: params.linkUrl,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  return pin?.id ? `https://www.pinterest.com/pin/${pin.id}` : undefined;
}
