import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { liveQuery } from 'dexie';
import { db, deleteProject } from '../core/db';
import { VIDEO_ACCEPT, fromDataTransfer, isVideoFile, pickFiles, supportsFileSystemAccess, type PickedFile } from '../core/file-access';
import { ProjectsService, skippedNotice } from '../core/projects.service';
import { type Project, migrateProject } from '../engine/model';
import { sequenceDuration } from '../engine/sequence';
import { formatTime } from '../engine/timeline-math';
import { Icon } from '../shared/icon';

interface ProjectCard {
  project: Project;
  thumb: string | null;
}

type LaunchQueue = { setConsumer(cb: (params: { files: FileSystemFileHandle[] }) => void): void };

@Component({
  selector: 'app-projects',
  imports: [RouterLink, TranslocoPipe, Icon],
  templateUrl: './projects.html',
  styleUrl: './projects.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Projects {
  private readonly router = inject(Router);
  private readonly projectsService = inject(ProjectsService);
  private readonly transloco = inject(TranslocoService);

  protected readonly cards = signal<ProjectCard[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly fsAccess = supportsFileSystemAccess();
  protected readonly lastProjectId = this.projectsService.lastProject();
  protected readonly formatTime = formatTime;
  protected readonly sequenceDuration = sequenceDuration;

  private urls: string[] = [];

  constructor() {
    const sub = liveQuery(async () => {
      const projects = (await db.projects.orderBy('updatedAt').reverse().toArray()).map(migrateProject);
      const thumbs = await db.thumbs.bulkGet(projects.map((p) => p.id));
      return projects.map((project, i) => ({ project, blob: thumbs[i]?.blob ?? null }));
    }).subscribe((rows) => {
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls = [];
      this.cards.set(
        rows.map((r) => {
          const thumb = r.blob ? URL.createObjectURL(r.blob) : null;
          if (thumb) this.urls.push(thumb);
          return { project: r.project, thumb };
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.urls.forEach((u) => URL.revokeObjectURL(u));
    });

    // Installed PWA: "Open with LocalCutVideo" from the OS file manager lands here.
    const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
    launchQueue?.setConsumer(async ({ files }) => {
      if (files.length) await this.create(await Promise.all(files.map(async (handle) => ({ file: await handle.getFile(), handle }))));
    });
  }

  protected async open(): Promise<void> {
    const picked = await pickFiles(VIDEO_ACCEPT, this.transloco.translate('common.videoFiles'));
    if (picked.length) await this.create(picked);
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  protected async onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    this.dragging.set(false);
    // Resolve every item synchronously first: the DataTransfer is emptied after the first await.
    const pending = Array.from(e.dataTransfer?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => fromDataTransfer(i));
    const picked = (await Promise.all(pending)).filter((p): p is PickedFile => !!p);
    if (picked.length) await this.create(picked);
  }

  /** Fallback input, also used by automated tests. */
  protected async onInput(e: Event): Promise<void> {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (files.length) await this.create(files.map((file) => ({ file, handle: null })));
  }

  private async create(all: PickedFile[]): Promise<void> {
    const picked = all.filter((p) => isVideoFile(p.file));
    if (!picked.length) {
      this.errorKey.set('errors.notVideo');
      return;
    }
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      const { id, skipped } = await this.projectsService.createFromFiles(picked);
      if (skipped.length) this.projectsService.setFlash(skippedNotice(skipped));
      await this.router.navigate(['/app', id]);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      this.errorKey.set(
        message.includes('UNSUPPORTED_CODEC') ? 'errors.codec' : message.includes('NO_VIDEO') ? 'errors.noVideo' : 'errors.generic',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(project: Project, e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(this.transloco.translate('projects.confirmDelete', { name: project.name }))) return;
    await deleteProject(project.id);
    if (this.lastProjectId === project.id) this.projectsService.setLastProject(null);
  }

  protected relative(ts: number): string {
    const rtf = new Intl.RelativeTimeFormat(this.transloco.getActiveLang(), { numeric: 'auto' });
    const diff = (ts - Date.now()) / 1000;
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
    ];
    for (const [unit, seconds] of units) {
      if (Math.abs(diff) >= seconds) return rtf.format(Math.round(diff / seconds), unit);
    }
    return rtf.format(0, 'minute');
  }

  protected lastProject(): Project | null {
    return this.cards()?.find((c) => c.project.id === this.lastProjectId)?.project ?? null;
  }
}
