/**
 * Face tracking for auto-framing. MediaPipe's BlazeFace detector (GPU when available) runs
 * on frames sampled a few times per second; the path is then smoothed in framing.ts.
 * Everything, including the model, is served from this origin.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { FaceSample } from '../engine/framing';
import type { Rotation } from '../engine/model';
import { rotatedSize, rotationMatrix } from '../engine/render';

const SAMPLES_PER_SECOND = 3;
const MEDIAPIPE_METRICS = 'https://odml.pa.googleapis.com/';

/**
 * MediaPipe Tasks 1.x reports usage metrics to Google (never the frames themselves). This app
 * promises no tracking, so those requests are answered locally; the CSP would block them anyway.
 */
function dropMediaPipeMetrics(): void {
  const w = window as Window & { lcvFetchGuard?: boolean };
  if (w.lcvFetchGuard) return;
  w.lcvFetchGuard = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(MEDIAPIPE_METRICS)) return Promise.resolve(new Response(null, { status: 204 }));
    return originalFetch(input, init);
  };
}

export async function analyzeFaces(
  file: File,
  duration: number,
  onProgress: (p: number) => void,
  isCancelled: () => boolean,
  rotation: Rotation = 0,
): Promise<FaceSample[]> {
  dropMediaPipeMetrics();
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${location.origin}/mediapipe`);
  const create = (delegate: 'GPU' | 'CPU') =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${location.origin}/mediapipe/blaze_face_short_range.tflite`, delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.45,
    });
  const detector = await create('GPU').catch(() => create('CPU'));

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const samples: FaceSample[] = [];
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return samples;
    const frameW = 640;
    const frameH = Math.round((frameW * track.displayHeight) / track.displayWidth);
    const sink = new CanvasSink(track, { width: frameW, height: frameH, fit: 'fill', poolSize: 2 });
    // Faces are searched in the turned frame, so their positions match what the preview shows.
    const { width, height } = rotatedSize(frameW, frameH, rotation);
    const turned = document.createElement('canvas');
    turned.width = width;
    turned.height = height;
    const tc = turned.getContext('2d')!;
    tc.setTransform(...rotationMatrix(frameW, frameH, rotation));
    const times: number[] = [];
    for (let t = 0; t < duration; t += 1 / SAMPLES_PER_SECOND) times.push(t);

    // BlazeFace works on a 128 px input made for close-up faces. On a whole 16:9 frame a
    // speaker's face becomes tiny, so we scan overlapping squares along the long side instead.
    const side = Math.min(width, height);
    const along = Math.max(width, height) - side;
    const offsets = along > 0 ? [0, along / 2, along] : [0];
    const square = document.createElement('canvas');
    square.width = square.height = 256;
    const sq = square.getContext('2d')!;

    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (isCancelled()) break;
      const t = times[i++];
      if (!frame) {
        samples.push({ t, face: null });
        continue;
      }
      let image: CanvasImageSource = frame.canvas;
      if (rotation) {
        tc.drawImage(frame.canvas, 0, 0);
        image = turned;
      }
      let best: FaceSample['face'] = null;
      let bestScore = 0;
      for (const offset of offsets) {
        const ox = width >= height ? offset : 0;
        const oy = width >= height ? 0 : offset;
        sq.drawImage(image, ox, oy, side, side, 0, 0, 256, 256);
        for (const d of detector.detect(square).detections) {
          const box = d.boundingBox;
          const score = d.categories[0]?.score ?? 0;
          if (!box || score <= bestScore) continue;
          bestScore = score;
          const k = side / 256;
          best = {
            x: (ox + (box.originX + box.width / 2) * k) / width,
            y: (oy + (box.originY + box.height / 2) * k) / height,
            w: (box.width * k) / width,
          };
        }
      }
      samples.push({ t, face: best });
      if (i % 6 === 0) {
        onProgress(i / times.length);
        // Yield to keep the UI responsive between detections.
        await new Promise((r) => setTimeout(r));
      }
    }
    onProgress(1);
    return samples;
  } finally {
    input.dispose();
    detector.close();
  }
}
