import { useEffect, useRef, useState, type UIEvent } from 'react';
import { ANIMAL_VIDEOS } from '../config/tiktokVideos';

const TIKTOK_ORIGIN = 'https://www.tiktok.com';

export function TikTokFeed() {
  const [activeIndex, setActiveIndex] = useState(0);

  function updateActiveVideo(event: UIEvent<HTMLDivElement>) {
    const { scrollTop, clientHeight } = event.currentTarget;
    if (clientHeight === 0) return;
    const index = Math.round(scrollTop / clientHeight);
    setActiveIndex(Math.max(0, Math.min(index, ANIMAL_VIDEOS.length - 1)));
  }

  return (
    <div className="tiktok-feed" role="region" aria-label="TikTok 动物短视频，上下滑动切换" tabIndex={0} onScroll={updateActiveVideo}>
      {ANIMAL_VIDEOS.map((video, index) => (
        <div className="tiktok-slide" key={video.id}>
          {index === activeIndex && <TikTokPlayer video={video} index={index} />}
        </div>
      ))}
    </div>
  );
}

function TikTokPlayer({ video, index }: { video: (typeof ANIMAL_VIDEOS)[number]; index: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setUnavailable(true), 15000);
    function onPlayerMessage(event: MessageEvent) {
      if (event.origin !== TIKTOK_ORIGIN || event.source !== frameRef.current?.contentWindow || event.data?.['x-tiktok-player'] !== true) return;
      const { type, value } = event.data;
      if (type === 'onPlayerReady' || (type === 'onStateChange' && value === 1)) {
        clearTimeout(timeout);
        setUnavailable(false);
      } else if (type === 'onPlayerError' && value?.errorCode !== 3002) {
        clearTimeout(timeout);
        setUnavailable(true);
      }
    }
    window.addEventListener('message', onPlayerMessage);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', onPlayerMessage);
    };
  }, [attempt]);

  return (
    <>
      <iframe
        key={attempt}
        ref={frameRef}
        className="tiktok-player"
        title={`TikTok 视频 ${index + 1} / ${ANIMAL_VIDEOS.length} · @${video.author}`}
        src={`${TIKTOK_ORIGIN}/player/v1/${video.id}?autoplay=1&muted=1&loop=1&fullscreen_button=0`}
        allow="autoplay"
      />
      <div className="tiktok-scroll-surface" aria-hidden="true" />
      {unavailable && (
        <div className="tiktok-playback-error">
          <p role="status">此视频暂时无法加载</p>
          <div className="row wrap">
            <button className="btn" onClick={() => { setUnavailable(false); setAttempt((current) => current + 1); }}>
              重试
            </button>
            <a className="btn" href={`${TIKTOK_ORIGIN}/@${video.author}/video/${video.id}`} target="_blank" rel="noopener noreferrer">
              打开原帖
            </a>
          </div>
        </div>
      )}
    </>
  );
}
