/**
 * Sample video offered to visitors who have no video at hand. It is served by this site and
 * opened like any other file; a fixed date keeps its fingerprint (and cached analysis) stable.
 */
export const DEMO_FILE_NAME = 'localcutvideo-demo.mp4';
const DEMO_URL = `/demo/${DEMO_FILE_NAME}`;
const DEMO_DATE = Date.UTC(2026, 10, 1);

export function isDemoSource(source: { name: string }): boolean {
  return source.name === DEMO_FILE_NAME;
}

export async function fetchDemoVideo(): Promise<File> {
  const response = await fetch(DEMO_URL);
  if (!response.ok) throw new Error('DEMO_UNAVAILABLE');
  return new File([await response.blob()], DEMO_FILE_NAME, { type: 'video/mp4', lastModified: DEMO_DATE });
}
