import type { SelectOption } from '../shared/select';
import { LANGUAGES } from './languages';

/** Whisper's code of the interface languages that differ from it. */
const WHISPER_CODES: Record<string, string> = { 'pt-pt': 'pt', 'zh-cn': 'zh', nb: 'no', fil: 'tl' };

/** Languages offered for the speech of a video: one per language Whisper knows, regional variants merged. */
const SPOKEN = LANGUAGES.filter((l) => l.code !== 'pt-br' && l.code !== 'zh-tw').map((l) => ({ code: WHISPER_CODES[l.code] ?? l.code, flag: l.flag }));

/** Name of a spoken language in the interface language (Whisper may detect any of its 100). */
export function spokenLanguageName(code: string, interfaceLanguage: string): string {
  try {
    return new Intl.DisplayNames([interfaceLanguage], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Choices of the "spoken language" menus: automatic first, then by name. */
export function spokenLanguageOptions(autoLabel: string, interfaceLanguage: string): SelectOption[] {
  const capitalized = (name: string) => name.charAt(0).toLocaleUpperCase(interfaceLanguage) + name.slice(1);
  const named = SPOKEN.map(({ code, flag }) => ({ value: code, label: capitalized(spokenLanguageName(code, interfaceLanguage)), flag }));
  return [{ value: 'auto', label: autoLabel, icon: 'sparkles' }, ...named.sort((a, b) => a.label.localeCompare(b.label, interfaceLanguage))];
}
