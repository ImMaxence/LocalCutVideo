/**
 * Local file access. With the File System Access API (Chromium) we get a handle that can be
 * stored in IndexedDB and re-opened after a crash; elsewhere we fall back to a classic file
 * input and ask the user to re-select the same file later. Nothing is ever uploaded.
 */

export const VIDEO_ACCEPT = {
  'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
};

export const AUDIO_ACCEPT = {
  'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'],
};

export interface PickedFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};

type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function supportsFileSystemAccess(): boolean {
  return typeof (window as PickerWindow).showOpenFilePicker === 'function';
}

export function supportsSavePicker(): boolean {
  return typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

export async function pickFile(accept: Record<string, string[]>, description: string): Promise<PickedFile | null> {
  return (await pickFiles(accept, description, false))[0] ?? null;
}

export async function pickFiles(accept: Record<string, string[]>, description: string, multiple = true): Promise<PickedFile[]> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        id: Object.keys(accept)[0] === 'video/*' ? 'lcv-video' : 'lcv-audio',
        multiple,
        excludeAcceptAllOption: false,
        types: [{ description, accept }],
      });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return [];
      throw e;
    }
  }
  return pickWithInput(Object.values(accept).flat().concat(Object.keys(accept)).join(','), multiple);
}

function pickWithInput(accept: string, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? []).map((file) => ({ file, handle: null }))));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
}

/** Turns a drag & drop item into a file + handle when the browser allows it. */
export async function fromDataTransfer(item: DataTransferItem): Promise<PickedFile | null> {
  const withHandle = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
  if (withHandle.getAsFileSystemHandle) {
    const handle = await withHandle.getAsFileSystemHandle();
    if (handle?.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle;
      return { file: await fileHandle.getFile(), handle: fileHandle };
    }
  }
  const file = item.getAsFile();
  return file ? { file, handle: null } : null;
}

export async function queryReadPermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as PermissionHandle;
  return h.queryPermission ? h.queryPermission({ mode: 'read' }) : 'granted';
}

/** Must be called from a user gesture (click), browsers refuse it otherwise. */
export async function requestReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as PermissionHandle;
  if (!h.requestPermission) return true;
  return (await h.requestPermission({ mode: 'read' })) === 'granted';
}

export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | null | 'unsupported'> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) return 'unsupported';
  try {
    return await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }],
    });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    return 'unsupported';
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
