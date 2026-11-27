import video1 from '../../Videos/1.mp4?url';
import video2 from '../../Videos/2.mp4?url';
import video3 from '../../Videos/3.mp4?url';
import video4 from '../../Videos/4.mp4?url';
import video5 from '../../Videos/5.mp4?url';
import video6 from '../../Videos/6.mp4?url';
import video7 from '../../Videos/7.mp4?url';
import video8 from '../../Videos/8.mp4?url';
import video9 from '../../Videos/9.mp4?url';
import video10 from '../../Videos/10.mp4?url';
import video11 from '../../Videos/11.mp4?url';
import video12 from '../../Videos/12.mp4?url';
import video13 from '../../Videos/13.mp4?url';
import video14 from '../../Videos/14.mp4?url';
import video15 from '../../Videos/15.mp4?url';
import video16 from '../../Videos/16.mp4?url';
import video17 from '../../Videos/17.mp4?url';
import video18 from '../../Videos/18.mp4?url';
import video19 from '../../Videos/19.mp4?url';
import video20 from '../../Videos/20.mp4?url';
import video21 from '../../Videos/21.mp4?url';
import video22 from '../../Videos/22.mp4?url';
import video23 from '../../Videos/23.mp4?url';
import video24 from '../../Videos/24.mp4?url';

const VIDEO_URLS = [video1, video2, video3, video4, video5, video6, video7, video8, video9, video10, video11, video12, video13, video14, video15, video16, video17, video18, video19, video20, video21, video22, video23, video24];
const CACHE_NAME = 'beyond-the-mirror-videos-v2';
export const VIDEO_COUNT = VIDEO_URLS.length;

async function readMp4(response: Response): Promise<Blob> {
  if (response.status !== 200) throw new Error(`Video request returned ${response.status}`);

  const body = await response.blob();
  // 静态站点缺失文件时可能返回状态码 200 的首页。
  if ((await body.slice(4, 8).text()) !== 'ftyp') throw new Error('Expected an MP4 file');
  return body.type === 'video/mp4' ? body : body.slice(0, body.size, 'video/mp4');
}

async function loadVideo(url: string, cache: Cache | undefined, signal: AbortSignal): Promise<Blob> {
  const cached = await cache?.match(url)
    .then((response) => response && readMp4(response))
    .catch(() => undefined);
  if (cached) return cached;

  const video = await readMp4(await fetch(url, { signal }));
  // 浏览器无法持久化时，播放器仍可使用本次页面已经下载的文件。
  await cache?.put(url, new Response(video, { headers: { 'Content-Type': video.type } })).catch(() => {});
  return video;
}

export async function loadVideoLibrary(
  downloaded: Map<string, Blob>,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<Blob[]> {
  let cache: Cache | undefined;
  try {
    cache = await window.caches?.open(CACHE_NAME);
  } catch {
    // 当前浏览器或页面地址可能无法使用 Cache Storage。
  }

  const results = await Promise.allSettled(VIDEO_URLS.map(async (url) => {
    const video = downloaded.get(url) ?? await loadVideo(url, cache, signal);
    signal.throwIfAborted();
    downloaded.set(url, video);
    onProgress(downloaded.size);
    return video;
  }));
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}
