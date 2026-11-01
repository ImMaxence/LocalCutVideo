import { describe, expect, it } from 'vitest';
import { isFiller } from './fillers';
import { LEGACY_CLIP_ID, SCHEMA_VERSION, type Clip, type Project, clipHasVoice, createProject, migrateProject } from './model';

describe('project document', () => {
  it('upgrades an old single-video project', () => {
    const old = createProject('old') as Partial<Project> & Record<string, unknown>;
    delete old.clips;
    delete old.speeds;
    delete old.rotation;
    delete old.audio;
    old['source'] = { name: 'a.mp4', duration: 3 };
    const p = migrateProject(old as Project & { source?: never });
    expect(p.clips).toEqual([{ id: LEGACY_CLIP_ID, source: { name: 'a.mp4', duration: 3 } }]);
    expect(p.speeds).toEqual([]);
    expect(p.rotation).toBe(0);
    expect(p.audio).toEqual({ volume: 1, normalize: false, denoise: false });
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keeps settings that were already set', () => {
    const p = createProject('x');
    p.audio.volume = 2;
    p.captions.size = 1.4;
    expect(migrateProject(p).audio.volume).toBe(2);
    expect(migrateProject(p).captions.size).toBe(1.4);
  });

  it("uses the user's voice answer before the detection", () => {
    const clip = { id: 'a', source: {} } as Clip;
    expect(clipHasVoice(clip)).toBe(true);
    expect(clipHasVoice({ ...clip, voiceDetected: false })).toBe(false);
    expect(clipHasVoice({ ...clip, voice: true, voiceDetected: false })).toBe(true);
    expect(clipHasVoice({ ...clip, voice: null, voiceDetected: false })).toBe(false);
  });
});

describe('filler words', () => {
  it('recognizes hesitations in several languages', () => {
    const w = (text: string) => ({ id: text, text, start: 0, end: 1, deleted: false });
    expect(isFiller(w('euh'))).toBe(true);
    expect(isFiller(w('Um,'))).toBe(true);
    expect(isFiller(w('hello'))).toBe(false);
  });
});
