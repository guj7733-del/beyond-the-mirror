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
        <div className="tiktok-slide" key={video.id} data-active={index === activeIndex}>
          {Math.abs(index - activeIndex) <= 1 && <TikTokPlayer video={video} index={index} active={index === activeIndex} />}
        </div>
      ))}
    </div>
  );
}

function sendPlayerCommand(frame: HTMLIFrameElement | null, type: 'play' | 'pause' | 'mute') {
  frame?.contentWindow?.postMessage({ 'x-tiktok-player': true, type }, TIKTOK_ORIGIN);
}

function TikTokPlayer({ video, index, active }: { video: (typeof ANIMAL_VIDEOS)[number]; index: number; active: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    function onPlayerMessage(event: MessageEvent) {
      if (event.origin !== TIKTOK_ORIGIN || event.source !== frameRef.current?.contentWindow || event.data?.['x-tiktok-player'] !== true) return;
      const { type, value } = event.data;
      const playing = type === 'onStateChange' && value === 1;
      if (type === 'onPlayerReady' || playing) {
        setStatus('ready');
        // 等官方播放器实际开始解码后再暂停，保留下一条已经缓冲的画面。
        if (playing && !active) sendPlayerCommand(frameRef.current, 'pause');
      } else if (type === 'onPlayerError' && value?.errorCode !== 3002) {
        setStatus('unavailable');
      }
    }
    window.addEventListener('message', onPlayerMessage);
    return () => window.removeEventListener('message', onPlayerMessage);
  }, [active]);

  useEffect(() => {
    if (!active || status !== 'loading') return;
    const timeout = window.setTimeout(() => setStatus('unavailable'), 15000);
    return () => clearTimeout(timeout);
  }, [active, status, attempt]);

  useEffect(() => {
    if (!active || status !== 'ready') return;
    const frame = frameRef.current;
    sendPlayerCommand(frame, 'play');
    return () => {
      sendPlayerCommand(frame, 'pause');
      sendPlayerCommand(frame, 'mute');
    };
  }, [active, status]);

  return (
    <>
      <iframe
        key={attempt}
        ref={frameRef}
        className="tiktok-player"
        title={`TikTok 视频 ${index + 1} / ${ANIMAL_VIDEOS.length} · @${video.author}`}
        src={`${TIKTOK_ORIGIN}/player/v1/${video.id}?autoplay=1&muted=1&loop=1&fullscreen_button=0`}
        allow="autoplay"
        aria-hidden={!active}
        tabIndex={active ? 0 : -1}
      />
      <div className="tiktok-scroll-surface" aria-hidden="true" />
      {active && status === 'unavailable' && (
        <div className="tiktok-playback-error">
          <p role="status">此视频暂时无法加载</p>
          <div className="row wrap">
            <button className="btn" onClick={() => { setStatus('loading'); setAttempt((current) => current + 1); }}>
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
