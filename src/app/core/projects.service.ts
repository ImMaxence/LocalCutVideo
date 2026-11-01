import { Injectable, inject } from '@angular/core';
import { type Clip, createProject, defaultCaptionWords, uid } from '../engine/model';
import { db, storeClipFile } from './db';
import type { PickedFile } from './file-access';
import { WorkersService } from './workers.service';

const LAST_PROJECT_KEY = 'lcv-last-project';

export interface SkippedFile {
  name: string;
  error: unknown;
}

/** Names of the skipped files and the translation key explaining why (all share the first reason). */
export function skippedNotice(skipped: SkippedFile[]): { key: string; params: Record<string, unknown> } {
  const reason = String((skipped[0]?.error as Error)?.message ?? '');
  return {
    key: reason.includes('UNSUPPORTED_CODEC') ? 'errors.skippedCodec' : 'errors.skipped',
    params: { names: skipped.map((s) => s.name).join(', ') },
  };
}

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly workers = inject(WorkersService);
  /** Files picked in this session, handed to the editor without asking for permission again. */
  private readonly sessionFiles = new Map<string, File>();

  /**
   * Reads each file's metadata and turns it into a clip; the file handle is stored for crash
   * recovery. Files the browser cannot decode are skipped and reported instead of failing all.
   */
  async createClips(projectId: string, picked: PickedFile[]): Promise<{ clips: Clip[]; skipped: SkippedFile[] }> {
    const clips: Clip[] = [];
    const skipped: SkippedFile[] = [];
    for (const item of picked) {
      try {
        const source = await this.workers.media.probe(item.file);
        const clip = { id: uid(), source };
        await storeClipFile(projectId, clip.id, item.file, item.handle);
        this.rememberSessionFile(projectId, clip.id, item.file);
        clips.push(clip);
      } catch (e) {
        skipped.push({ name: item.file.name, error: e });
      }
    }
    if (!clips.length && skipped.length) throw skipped[0].error;
    return { clips, skipped };
  }

  /** Several files become one project whose clips play back to back, in name order. */
  async createFromFiles(picked: PickedFile[]): Promise<{ id: string; skipped: SkippedFile[] }> {
    const sorted = picked.slice().sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    const project = createProject(sorted[0].file.name.replace(/\.[^.]+$/, ''));
    const { clips, skipped } = await this.createClips(project.id, sorted);
    project.clips = clips;
    const first = sorted.find((p) => p.file.name === clips[0].source.name)?.file ?? sorted[0].file;
    const { width, height } = project.clips[0].source;
    project.format = width >= height ? '16:9' : '9:16';
    project.captions.maxWords = defaultCaptionWords(project.format);

    await db.projects.put(project);
    void this.saveThumbnail(project.id, first, Math.min(1, project.clips[0].source.duration / 2));
    // Ask the browser not to evict our IndexedDB data under storage pressure.
    void navigator.storage?.persist?.();
    return { id: project.id, skipped };
  }

  /** A message to show once the editor opens (e.g. files skipped during the import). */
  private flash: { key: string; params: Record<string, unknown> } | null = null;

  setFlash(message: { key: string; params: Record<string, unknown> } | null): void {
    this.flash = message;
  }

  takeFlash(): { key: string; params: Record<string, unknown> } | null {
    const message = this.flash;
    this.flash = null;
    return message;
  }

  takeSessionFile(projectId: string, clipId: string): File | null {
    return this.sessionFiles.get(`${projectId}:${clipId}`) ?? null;
  }

  rememberSessionFile(projectId: string, clipId: string, file: File): void {
    this.sessionFiles.set(`${projectId}:${clipId}`, file);
  }

  async saveThumbnail(projectId: string, file: File, at: number): Promise<void> {
    try {
      const blob = await this.workers.media.thumbnail(file, at);
      if (blob) await db.thumbs.put({ projectId, blob });
    } catch {
      // A missing thumbnail is purely cosmetic.
    }
  }

  setLastProject(id: string | null): void {
    try {
      if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
      else localStorage.removeItem(LAST_PROJECT_KEY);
    } catch {
      // ignore
    }
  }

  lastProject(): string | null {
    try {
      return localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
      return null;
    }
  }
}
