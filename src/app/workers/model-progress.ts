/** What a model does before it can run: download (once), then preparation on the device. */
export interface ModelLoadProgress {
  stage: 'download' | 'load';
  progress: number;
}

/** Transformers.js callback reporting a model's download as a whole, then its preparation. */
export function modelProgress(onProgress: (p: ModelLoadProgress) => void): (info: { status: string; progress?: number }) => void {
  return (info) => {
    if (info.status !== 'progress_total') return;
    const progress = (info.progress ?? 0) / 100;
    onProgress(progress >= 1 ? { stage: 'load', progress: 0 } : { stage: 'download', progress });
  };
}
