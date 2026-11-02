/**
 * Interface languages. Plain data without imports: scripts/sitemap.mjs reads it too.
 *
 * - `code`: URL segment (/pt-br/…), i18n file (public/i18n/pt-br.json) and Transloco id
 * - `tag`: BCP 47 tag of `<html lang>`
 * - `hreflang`: what search engines may serve this version for (a generic `pt` or `zh` covers
 *   the countries without their own version)
 * - `og`: Open Graph locale
 * - `flag`: country of the flag shown next to the name (see shared/flag.ts)
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', tag: 'en', hreflang: ['en'], og: 'en_US', flag: 'gb' },
  { code: 'fr', label: 'Français', tag: 'fr', hreflang: ['fr'], og: 'fr_FR', flag: 'fr' },
  { code: 'es', label: 'Español', tag: 'es', hreflang: ['es'], og: 'es_ES', flag: 'es' },
  { code: 'pt-br', label: 'Português (Brasil)', tag: 'pt-BR', hreflang: ['pt-BR'], og: 'pt_BR', flag: 'br' },
  { code: 'pt-pt', label: 'Português (Portugal)', tag: 'pt-PT', hreflang: ['pt-PT', 'pt'], og: 'pt_PT', flag: 'pt' },
  { code: 'de', label: 'Deutsch', tag: 'de', hreflang: ['de'], og: 'de_DE', flag: 'de' },
  { code: 'it', label: 'Italiano', tag: 'it', hreflang: ['it'], og: 'it_IT', flag: 'it' },
  { code: 'nl', label: 'Nederlands', tag: 'nl', hreflang: ['nl'], og: 'nl_NL', flag: 'nl' },
  { code: 'sv', label: 'Svenska', tag: 'sv', hreflang: ['sv'], og: 'sv_SE', flag: 'se' },
  { code: 'da', label: 'Dansk', tag: 'da', hreflang: ['da'], og: 'da_DK', flag: 'dk' },
  { code: 'nb', label: 'Norsk', tag: 'nb', hreflang: ['nb', 'no'], og: 'nb_NO', flag: 'no' },
  { code: 'fi', label: 'Suomi', tag: 'fi', hreflang: ['fi'], og: 'fi_FI', flag: 'fi' },
  { code: 'et', label: 'Eesti', tag: 'et', hreflang: ['et'], og: 'et_EE', flag: 'ee' },
  { code: 'lv', label: 'Latviešu', tag: 'lv', hreflang: ['lv'], og: 'lv_LV', flag: 'lv' },
  { code: 'lt', label: 'Lietuvių', tag: 'lt', hreflang: ['lt'], og: 'lt_LT', flag: 'lt' },
  { code: 'pl', label: 'Polski', tag: 'pl', hreflang: ['pl'], og: 'pl_PL', flag: 'pl' },
  { code: 'cs', label: 'Čeština', tag: 'cs', hreflang: ['cs'], og: 'cs_CZ', flag: 'cz' },
  { code: 'sk', label: 'Slovenčina', tag: 'sk', hreflang: ['sk'], og: 'sk_SK', flag: 'sk' },
  { code: 'hu', label: 'Magyar', tag: 'hu', hreflang: ['hu'], og: 'hu_HU', flag: 'hu' },
  { code: 'ro', label: 'Română', tag: 'ro', hreflang: ['ro'], og: 'ro_RO', flag: 'ro' },
  { code: 'bg', label: 'Български', tag: 'bg', hreflang: ['bg'], og: 'bg_BG', flag: 'bg' },
  { code: 'el', label: 'Ελληνικά', tag: 'el', hreflang: ['el'], og: 'el_GR', flag: 'gr' },
  { code: 'hr', label: 'Hrvatski', tag: 'hr', hreflang: ['hr', 'bs'], og: 'hr_HR', flag: 'hr' },
  { code: 'sr', label: 'Српски', tag: 'sr', hreflang: ['sr'], og: 'sr_RS', flag: 'rs' },
  { code: 'sl', label: 'Slovenščina', tag: 'sl', hreflang: ['sl'], og: 'sl_SI', flag: 'si' },
  { code: 'uk', label: 'Українська', tag: 'uk', hreflang: ['uk'], og: 'uk_UA', flag: 'ua' },
  { code: 'ru', label: 'Русский', tag: 'ru', hreflang: ['ru'], og: 'ru_RU', flag: 'ru' },
  { code: 'tr', label: 'Türkçe', tag: 'tr', hreflang: ['tr'], og: 'tr_TR', flag: 'tr' },
  { code: 'ar', label: 'العربية', tag: 'ar', hreflang: ['ar'], og: 'ar_AR', flag: 'sa', rtl: true },
  { code: 'he', label: 'עברית', tag: 'he', hreflang: ['he'], og: 'he_IL', flag: 'il', rtl: true },
  { code: 'fa', label: 'فارسی', tag: 'fa', hreflang: ['fa'], og: 'fa_IR', flag: 'ir', rtl: true },
  { code: 'ja', label: '日本語', tag: 'ja', hreflang: ['ja'], og: 'ja_JP', flag: 'jp' },
  { code: 'ko', label: '한국어', tag: 'ko', hreflang: ['ko'], og: 'ko_KR', flag: 'kr' },
  { code: 'zh-cn', label: '简体中文', tag: 'zh-CN', hreflang: ['zh-CN', 'zh-SG', 'zh'], og: 'zh_CN', flag: 'cn' },
  { code: 'zh-tw', label: '繁體中文', tag: 'zh-TW', hreflang: ['zh-TW', 'zh-HK', 'zh-MO'], og: 'zh_TW', flag: 'tw' },
  { code: 'hi', label: 'हिन्दी', tag: 'hi', hreflang: ['hi'], og: 'hi_IN', flag: 'in' },
  { code: 'bn', label: 'বাংলা', tag: 'bn', hreflang: ['bn'], og: 'bn_IN', flag: 'bd' },
  { code: 'ur', label: 'اردو', tag: 'ur', hreflang: ['ur'], og: 'ur_PK', flag: 'pk', rtl: true },
  { code: 'id', label: 'Bahasa Indonesia', tag: 'id', hreflang: ['id'], og: 'id_ID', flag: 'id' },
  { code: 'ms', label: 'Bahasa Melayu', tag: 'ms', hreflang: ['ms'], og: 'ms_MY', flag: 'my' },
  { code: 'th', label: 'ไทย', tag: 'th', hreflang: ['th'], og: 'th_TH', flag: 'th' },
  { code: 'vi', label: 'Tiếng Việt', tag: 'vi', hreflang: ['vi'], og: 'vi_VN', flag: 'vn' },
  { code: 'fil', label: 'Filipino', tag: 'fil', hreflang: ['fil', 'tl'], og: 'tl_PH', flag: 'ph' },
  { code: 'sw', label: 'Kiswahili', tag: 'sw', hreflang: ['sw'], og: 'sw_KE', flag: 'tz' },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LangCode = Language['code'];

/** Older or neighbouring codes browsers may send, and the version they get. */
const ALIASES: Record<string, LangCode> = { no: 'nb', nn: 'nb', tl: 'fil', iw: 'he', in: 'id', bs: 'hr', me: 'sr', zsm: 'ms', pes: 'fa', prs: 'fa' };
/** Regions writing in traditional characters, when the tag names no script (zh-Hans-HK stays simplified). */
const CHINESE_TRADITIONAL = ['tw', 'hk', 'mo'];

/**
 * Interface language for a browser language (navigator.languages): 'pt-PT' → 'pt-pt',
 * 'pt' → 'pt-br', 'zh-HK' → 'zh-tw', 'nn' → 'nb'… null when there is no version for it.
 * Kept in sync with public/theme-init.js, which redirects before Angular starts.
 */
export function languageFor(browserTag: string): LangCode | null {
  const [base, ...rest] = browserTag.toLowerCase().split(/[-_]/);
  if (base === 'zh') {
    const script = rest.find((s) => s === 'hans' || s === 'hant');
    return (script ? script === 'hant' : rest.some((s) => CHINESE_TRADITIONAL.includes(s))) ? 'zh-tw' : 'zh-cn';
  }
  if (base === 'pt') return rest.length && rest[0] !== 'br' ? 'pt-pt' : 'pt-br';
  const code = ALIASES[base] ?? base;
  return LANGUAGES.some((l) => l.code === code) ? (code as LangCode) : null;
}
