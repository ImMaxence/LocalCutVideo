/**
 * Project files (.lcv.json): the edit itself (clips described by name and size, cuts, speed
 * changes, words, settings) without any video, to move a project to another computer or keep
 * a backup. Opening one creates a new project whose videos are then reconnected by hand.
 */
import { type Project, isProjectShape, migrateProject, uid } from '../engine/model';
import { db } from './db';
import { downloadBlob } from './file-access';
import { APP_VERSION } from './version';

const FORMAT = 'localcutvideo-project';
const VERSION = 1;

export const PROJECT_FILE_ACCEPT = '.json,application/json';

export function isProjectFile(file: File): boolean {
  return /\.json$/i.test(file.name) || file.type === 'application/json';
}

export function saveProjectFile(project: Project): void {
  const data = { format: FORMAT, version: VERSION, app: APP_VERSION, exportedAt: new Date().toISOString(), project };
  const name = `${project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project'}.lcv.json`;
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
}

/** Saves the project of a file as a new project and returns its id. Throws NOT_A_PROJECT. */
export async function openProjectFile(file: File): Promise<string> {
  let doc: { format?: unknown; project?: Project } | null = null;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    // handled below
  }
  if (doc?.format !== FORMAT || !isProjectShape(doc.project)) throw new Error('NOT_A_PROJECT');
  const now = Date.now();
  const project: Project = { ...migrateProject(doc.project), id: uid(), createdAt: now, updatedAt: now };
  await db.projects.put(project);
  return project.id;
}
