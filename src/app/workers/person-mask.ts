/**
 * Person mask for the background blur: MediaPipe's selfie segmenter (model served by this
 * site) tells, for each frame, where the person is. Used by the preview (main thread) and by
 * the export worker, which loads MediaPipe's ES module build.
 */
import type { ImageSegmenter } from '@mediapipe/tasks-vision';

const METRICS = 'https://odml.pa.googleapis.com/';

/**
 * MediaPipe reports usage metrics to Google (never the frames). This app promises no tracking,
 * so those requests are answered locally; the CSP would block them anyway.
 */
function dropMetrics(): void {
  const scope = globalThis as typeof globalThis & { lcvMaskFetchGuard?: boolean };
  if (scope.lcvMaskFetchGuard) return;
  scope.lcvMaskFetchGuard = true;
  const original = scope.fetch.bind(scope);
  scope.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(METRICS)) return Promise.resolve(new Response(null, { status: 204 }));
    return original(input, init);
  };
}

export class PersonMask {
  private readonly canvas = new OffscreenCanvas(1, 1);
  private readonly ctx = this.canvas.getContext('2d')!;
  private image: ImageData | null = null;

  private constructor(private readonly segmenter: ImageSegmenter) {}

  /** `module`: MediaPipe's ES module build, the only one that loads in a module worker. */
  static async create(origin: string, module: boolean): Promise<PersonMask> {
    dropMetrics();
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${origin}/mediapipe`, module);
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${origin}/mediapipe/selfie_segmenter.tflite`, delegate },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
        ...(module ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      });
    return new PersonMask(await create('GPU').catch(() => create('CPU')));
  }

  /** A small canvas whose alpha is the person (opaque) and the background (transparent). */
  mask(frame: OffscreenCanvas): OffscreenCanvas | null {
    const result = this.segmenter.segment(frame);
    try {
      const confidence = result.confidenceMasks?.[0];
      if (!confidence) return null;
      const { width, height } = confidence;
      const values = confidence.getAsFloat32Array();
      if (this.canvas.width !== width || this.canvas.height !== height || !this.image) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.image = new ImageData(width, height);
        this.image.data.fill(255);
      }
      const data = this.image.data;
      // A slightly steep curve: crisper edges than the raw probability.
      for (let i = 0; i < values.length; i++) data[i * 4 + 3] = Math.max(0, Math.min(255, (values[i] - 0.25) * 510));
      this.ctx.putImageData(this.image, 0, 0);
      return this.canvas;
    } finally {
      result.close();
    }
  }

  close(): void {
    this.segmenter.close();
  }
}
