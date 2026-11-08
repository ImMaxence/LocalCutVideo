import { Dexie, type Table } from 'dexie';
import type { ImageModelId } from './image-models';
import { type AspectFormat, type AudioAnalysis, LEGACY_CLIP_ID, type Project } from '../engine/model';

export type FileRole = 'clip' | 'music';

/**
 * A file the project points to. The FileSystemFileHandle survives reloads (Chromium), which
 * is what makes crash recovery possible without ever copying the video into the browser.
 */
export interface StoredFile {
  key: string;
  projectId: string;
  role: FileRole;
  handle: FileSystemFileHandle | null;
  name: string;
  size: number;
  lastModified: number;
  type: string;
}

export interface StoredThumb {
  projectId: string;
  blob: Blob;
}

export interface CachedTranscript {
  key: string;
  words: { text: string; start: number; end: number }[];
  createdAt: number;
}

/** A picture made by the image model, kept on this device so it can be used again. */
export interface StoredAiImage {
  id?: number;
  blob: Blob;
  prompt: string;
  format: AspectFormat;
  /** Absent on pictures made before the model could be chosen. */
  model?: ImageModelId;
  createdAt: number;
}

class LocalCutDb extends Dexie {
  projects!: Table<Project, string>;
  files!: Table<StoredFile, string>;
  analysis!: Table<AudioAnalysis, string>;
  thumbs!: Table<StoredThumb, string>;
  transcripts!: Table<CachedTranscript, string>;
  aiImages!: Table<StoredAiImage, number>;

  constructor() {
    super('localcutvideo');
    this.version(1).stores({
      projects: 'id, updatedAt',
      files: 'key, projectId',
      analysis: 'fingerprint',
      thumbs: 'projectId',
      transcripts: 'key',
    });
    this.version(2).stores({ aiImages: '++id, createdAt' });
  }
}

export const db = new LocalCutDb();

export function clipKey(projectId: string, clipId: string): string {
  return `${projectId}:clip:${clipId}`;
}

export function musicKey(projectId: string): string {
  return `${projectId}:music`;
}

export async function getClipFile(projectId: string, clipId: string): Promise<StoredFile | undefined> {
  const stored = await db.files.get(clipKey(projectId, clipId));
  // Projects created before multi-clip support stored their single video under ":video".
  if (!stored && clipId === LEGACY_CLIP_ID) return db.files.get(`${projectId}:video`);
  return stored;
}

export async function storeClipFile(projectId: string, clipId: string, file: File, handle: FileSystemFileHandle | null): Promise<void> {
  await db.files.put({
    key: clipKey(projectId, clipId),
    projectId,
    role: 'clip',
    handle,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type,
  });
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.files, db.thumbs], async () => {
    await db.projects.delete(id);
    await db.files.where('projectId').equals(id).delete();
    await db.thumbs.delete(id);
  });
}
