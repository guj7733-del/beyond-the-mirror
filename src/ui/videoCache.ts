import video1 from '../../Videos/1.mp4?url';
import video2 from '../../Videos/2.mp4?url';
import video3 from '../../Videos/3.mp4?url';
import video4 from '../../Videos/4.mp4?url';
import video5 from '../../Videos/5.mp4?url';
import video6 from '../../Videos/6.mp4?url';
import video7 from '../../Videos/7.mp4?url';
import video8 from '../../Videos/8.mp4?url';

const VIDEO_URLS = [video1, video2, video3, video4, video5, video6, video7, video8];
const CACHE_NAME = 'beyond-the-mirror-videos-v1';
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
