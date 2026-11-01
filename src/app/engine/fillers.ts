import type { Word } from './model';

/** Hesitation sounds per language. Whisper sometimes omits them, but catches most. */
const FILLERS = new Set([
  // fr
  'euh', 'euhh', 'heu', 'hum', 'hmm', 'bah', 'ben', 'beh', 'eh',
  // en
  'um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hm', 'mm', 'mhm',
  // es
  'em', 'ehm', 'mmm',
  // it
  'ehm', 'mah', 'boh',
  // de
  'äh', 'ähm', 'öh', 'öhm', 'hmm',
]);

export function normalizeWord(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[.,!?;:…"«»“”()[\]¿¡-]/g, '')
    .trim();
}

export function isFiller(word: Word): boolean {
  return FILLERS.has(normalizeWord(word.text));
}
