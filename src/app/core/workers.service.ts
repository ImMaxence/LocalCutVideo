import { Injectable } from '@angular/core';
import * as Comlink from 'comlink';
import type { AiWorkerApi, ExportWorkerApi, MediaWorkerApi } from '../workers/worker-types';

/**
 * Owns the three dedicated workers. They are created on first use so the landing page
 * never pays for them, and kept alive so models and decoders stay warm.
 */
@Injectable({ providedIn: 'root' })
export class WorkersService {
  private mediaRemote?: Comlink.Remote<MediaWorkerApi>;
  private aiRemote?: Comlink.Remote<AiWorkerApi>;
  private exportRemote?: Comlink.Remote<ExportWorkerApi>;

  get media(): Comlink.Remote<MediaWorkerApi> {
    this.mediaRemote ??= Comlink.wrap<MediaWorkerApi>(
      new Worker(new URL('../workers/media.worker', import.meta.url), { type: 'module', name: 'lcv-media' }),
    );
    return this.mediaRemote;
  }

  get ai(): Comlink.Remote<AiWorkerApi> {
    this.aiRemote ??= Comlink.wrap<AiWorkerApi>(
      new Worker(new URL('../workers/ai.worker', import.meta.url), { type: 'module', name: 'lcv-ai' }),
    );
    return this.aiRemote;
  }

  get exporter(): Comlink.Remote<ExportWorkerApi> {
    this.exportRemote ??= Comlink.wrap<ExportWorkerApi>(
      new Worker(new URL('../workers/export.worker', import.meta.url), { type: 'module', name: 'lcv-export' }),
    );
    return this.exportRemote;
  }
}

export const proxy = Comlink.proxy;
export const transfer = Comlink.transfer;
