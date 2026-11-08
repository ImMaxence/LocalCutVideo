import { describe, expect, it } from 'vitest';
import { languagesToCheck, rankLanguages, settleLanguage } from './language';

describe('spoken language', () => {
  it('averages the samples', () => {
    expect(rankLanguages([{ fr: 0.9, en: 0.1 }, { fr: 0.3, en: 0.7 }]).map(([code]) => code)).toEqual(['fr', 'en']);
  });

  it('checks English and a credible runner-up', () => {
    expect(languagesToCheck([['fr', 0.8], ['br', 0.15]])).toEqual(['en', 'br']);
    expect(languagesToCheck([['fr', 0.95], ['br', 0.02]])).toEqual(['en']);
    expect(languagesToCheck([['en', 0.99], ['hi', 0.01]])).toEqual([]);
  });

  it('corrects English heard as French because of the accent', () => {
    expect(settleLanguage('fr', { fr: -1.178, en: -0.103 })).toBe('en');
  });

  it('keeps the guess when the difference is small', () => {
    expect(settleLanguage('fr', { fr: -0.248, en: -0.227 })).toBe('fr');
    expect(settleLanguage('fr', { fr: -0.107, en: -0.348 })).toBe('fr');
  });
});
