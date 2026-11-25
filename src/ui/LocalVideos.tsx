import { useEffect, useRef, useState, type UIEvent } from 'react';
import { loadVideoLibrary, VIDEO_COUNT } from './videoCache';

export function LocalVideos({ visible }: { visible: boolean }) {
  const downloaded = useRef(new Map<string, Blob>());
  const [files, setFiles] = useState<Blob[] | null>(null);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadVideoLibrary(downloaded.current, controller.signal, setCompleted).then(
      (library) => { if (!controller.signal.aborted) setFiles(library); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [attempt]);

  if (!visible) return null;
  if (files) return <VideoFeed files={files} />;

  return (
    <div className="video-cache-screen">
      <div className="video-notice">
        <p role="status">{failed ? '部分视频缓存失败' : '正在缓存短视频'}（{completed} / {VIDEO_COUNT}）</p>
        <progress value={completed} max={VIDEO_COUNT} aria-label="短视频缓存进度" />
        {failed ? (
          <button className="btn" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>重试缓存</button>
        ) : (
          <p className="video-cache-hint">全部就绪后会自动播放</p>
        )}
      </div>
    </div>
  );
}

function VideoFeed({ files }: { files: Blob[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  function updateActiveVideo(event: UIEvent<HTMLDivElement>) {
    const { scrollTop, clientHeight } = event.currentTarget;
    if (clientHeight === 0) return;
    const index = Math.round(scrollTop / clientHeight);
    setActiveIndex(Math.max(0, Math.min(index, files.length - 1)));
  }

  return (
    <div className="video-feed" role="region" aria-label="本地短视频，上下滑动切换" tabIndex={0} onScroll={updateActiveVideo}>
      {files.map((file, index) => (
        <div className="video-slide" key={index} data-active={index === activeIndex}>
          {Math.abs(index - activeIndex) <= 1 && (
            <VideoPlayer file={file} active={index === activeIndex} label={`视频 ${index + 1} / ${files.length}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function VideoPlayer({ file, active, label }: { file: Blob; active: boolean; label: string }) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const player = playerRef.current!;
    const url = URL.createObjectURL(file);
    player.src = url;
    return () => {
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!active) return;
    const player = playerRef.current!;
    let current = true;
    void player.play().catch(() => {
      if (current && !player.error) setNeedsTap(true);
    });
    return () => {
      current = false;
      player.pause();
    };
  }, [active]);

  return (
    <>
      <video
        ref={playerRef}
        className="video-player"
        aria-label={label}
        aria-hidden={!active}
        preload="auto"
        muted
        playsInline
        loop
        onPlaying={() => setNeedsTap(false)}
        onError={() => setFailed(true)}
      />
      {active && failed && <p className="video-notice video-playback-notice" role="status">此视频无法播放，请滑动继续</p>}
      {active && needsTap && !failed && (
        <button className="btn video-playback-notice" onClick={() => { void playerRef.current?.play().catch(() => {}); }}>
          点按播放
        </button>
      )}
    </>
  );
}
