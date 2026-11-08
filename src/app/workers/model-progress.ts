/** What a model does before it can run: download (once), then preparation on the device. */
export interface ModelLoadProgress {
  stage: 'download' | 'load';
  progress: number;
  /** Bytes received and expected, during a download. */
  loaded?: number;
  total?: number;
}

/**
 * Transformers.js callback reporting a model's download as a whole, then its preparation.
 * It also reports progress while reading its own cache: `fromCache` silences that, since
 * nothing is being downloaded then.
 */
export function modelProgress(onProgress: (p: ModelLoadProgress) => void, fromCache = false): (info: { status: string; progress?: number; loaded?: number; total?: number }) => void {
  return (info) => {
    if (fromCache || info.status !== 'progress_total') return;
    const progress = (info.progress ?? 0) / 100;
    onProgress(progress >= 1 ? { stage: 'load', progress: 0 } : { stage: 'download', progress, loaded: info.loaded, total: info.total });
  };
}

const WEIGHT_SUFFIX: Record<string, string> = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4' };

/** Whether the weights of a Whisper model, in these precisions, are already in the browser cache. */
export async function whisperIsCached(repo: string, revision: string, dtype: { encoder_model: string; decoder_model_merged: string }): Promise<boolean> {
  try {
    const keys = (await (await caches.open('transformers-cache')).keys()).map((request) => decodeURIComponent(request.url));
    const has = (file: string) => keys.some((url) => url.includes(`${repo}/resolve/${revision}/`) && url.endsWith(file));
    return has(`/onnx/encoder_model${WEIGHT_SUFFIX[dtype.encoder_model]}.onnx`) && has(`/onnx/decoder_model_merged${WEIGHT_SUFFIX[dtype.decoder_model_merged]}.onnx`);
  } catch {
    return false;
  }
}
