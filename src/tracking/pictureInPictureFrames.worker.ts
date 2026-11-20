type Start = { track: MediaStreamTrack };
type Command = Start | 'next' | 'stop';

const worker = self as unknown as {
  MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack; maxBufferSize: number }) => {
    readable: ReadableStream<VideoFrame>;
  };
  onmessage: ((event: MessageEvent<Command>) => void) | null;
  postMessage: (message: VideoFrame | null, transfer?: Transferable[]) => void;
  close: () => void;
};

let track: MediaStreamTrack | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let lastFrameTime = -Infinity;

function stop(): void {
  track?.stop();
  void reader?.cancel().catch(() => undefined);
  worker.close();
}

async function sendFrame(): Promise<void> {
  if (!reader) return;
  try {
    // Keep at most one transferred frame in flight, including while Safari suspends the page.
    for (;;) {
      const { done, value: frame } = await reader.read();
      if (done) break;
      if (frame.timestamp - lastFrameTime < 65_000) {
        frame.close();
        continue;
      }
      lastFrameTime = frame.timestamp;
      try {
        worker.postMessage(frame, [frame]);
      } finally {
        frame.close();
      }
      return;
    }
  } catch {
    // The main thread can still use the camera video element.
  }
  worker.postMessage(null);
  stop();
}

worker.onmessage = ({ data }) => {
  if (data === 'stop') {
    stop();
  } else if (data === 'next') {
    void sendFrame();
  } else {
    track = data.track;
    try {
      if (!worker.MediaStreamTrackProcessor) throw new Error('Track processor unavailable');
      reader = new worker.MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
      void sendFrame();
    } catch {
      worker.postMessage(null);
      stop();
    }
  }
};
