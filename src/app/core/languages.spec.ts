/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import script from '../../../public/theme-init.js?raw';
import { LANGUAGES, languageFor } from './languages';

const TAGS = ['en-US', 'fr-CA', 'pt', 'pt-BR', 'pt-PT', 'pt-AO', 'zh', 'zh-CN', 'zh-SG', 'zh-Hans-HK', 'zh-TW', 'zh-HK', 'zh-Hant', 'zh_MO', 'no', 'nn-NO', 'tl', 'iw', 'in', 'bs-BA', 'sr-Latn-ME', 'xx-YY'];

/** The copy of the rules in public/theme-init.js, which redirects before Angular starts. */
function earlyLanguageFor(): { langs: string[]; languageFor: (tag: string) => string | null } {
  const rules = script.slice(script.indexOf('var langs'), script.indexOf('var lang = null'));
  return new Function(`${rules} return { langs: langs, languageFor: languageFor };`)();
}

describe('languages', () => {
  it('has a translation file for every language', () => {
    const files = Object.keys(import.meta.glob('/public/i18n/*.json')).map((f) => f.slice('/public/i18n/'.length, -'.json'.length));
    expect(files.sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  it('has every text of the English file in every language, with the same placeholders', () => {
    const files = import.meta.glob<Record<string, unknown>>('/public/i18n/*.json', { eager: true, import: 'default' });
    const texts = (o: Record<string, unknown>, prefix = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? texts(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]]));
    const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort().join();
    const en = new Map(texts(files['/public/i18n/en.json']));
    for (const [file, json] of Object.entries(files)) {
      const own = new Map(texts(json));
      expect([...own.keys()].sort(), file).toEqual([...en.keys()].sort());
      for (const [key, text] of en) expect(placeholders(own.get(key) ?? ''), `${file} ${key}`).toBe(placeholders(text));
    }
  });

  it('maps browser languages to a site language', () => {
    expect(languageFor('fr-CA')).toBe('fr');
    expect(languageFor('en')).toBe('en');
    expect(languageFor('xx-YY')).toBeNull();
  });

  it('tells the Portuguese and Chinese variants apart', () => {
    expect(languageFor('pt')).toBe('pt-br');
    expect(languageFor('pt-BR')).toBe('pt-br');
    expect(languageFor('pt-PT')).toBe('pt-pt');
    expect(languageFor('pt-AO')).toBe('pt-pt');
    expect(languageFor('zh')).toBe('zh-cn');
    expect(languageFor('zh-SG')).toBe('zh-cn');
    expect(languageFor('zh-Hans-HK')).toBe('zh-cn');
    expect(languageFor('zh-TW')).toBe('zh-tw');
    expect(languageFor('zh-HK')).toBe('zh-tw');
    expect(languageFor('zh-Hant')).toBe('zh-tw');
  });

  it('follows the old and neighbouring language codes', () => {
    expect(languageFor('no')).toBe('nb');
    expect(languageFor('nn-NO')).toBe('nb');
    expect(languageFor('tl')).toBe('fil');
    expect(languageFor('iw')).toBe('he');
    expect(languageFor('bs-BA')).toBe('hr');
  });

  it('redirects early with the same list and rules', () => {
    const early = earlyLanguageFor();
    expect(early.langs).toEqual(LANGUAGES.map((l) => l.code));
    for (const tag of TAGS) expect(early.languageFor(tag), tag).toBe(languageFor(tag));
  });
});
