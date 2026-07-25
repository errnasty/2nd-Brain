/**
 * Lightweight language detection for article text — no dependency, no network,
 * no AI call. Runs on every opened article, so it has to be cheap and it has to
 * fail quiet: an uncertain guess returns null and the reader simply doesn't
 * offer a translation, which is far better than confidently mislabelling an
 * English article as Dutch and nagging to translate it.
 *
 * Two stages:
 *   1. Script detection (CJK, Cyrillic, Greek, Arabic, Hebrew, …) — decisive
 *      when present, since those scripts are effectively unambiguous here.
 *   2. Stopword scoring for Latin-script languages, which needs a reasonable
 *      amount of text and a clear winner before it commits.
 */

export type LanguageCode =
  | "en" | "es" | "fr" | "de" | "it" | "pt" | "nl" | "sv" | "da" | "no" | "fi"
  | "pl" | "cs" | "tr" | "id" | "vi" | "ro" | "hu"
  | "zh" | "ja" | "ko" | "ru" | "uk" | "el" | "ar" | "he" | "hi" | "th";

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", sv: "Swedish", da: "Danish", no: "Norwegian",
  fi: "Finnish", pl: "Polish", cs: "Czech", tr: "Turkish", id: "Indonesian",
  vi: "Vietnamese", ro: "Romanian", hu: "Hungarian", zh: "Chinese",
  ja: "Japanese", ko: "Korean", ru: "Russian", uk: "Ukrainian", el: "Greek",
  ar: "Arabic", he: "Hebrew", hi: "Hindi", th: "Thai",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code as LanguageCode] ?? code.toUpperCase();
}

/** Function words that carry most of the signal, per Latin-script language.
 *  Deliberately short and high-frequency — long lists don't improve accuracy
 *  on article-length text and cost more to scan. */
const STOPWORDS: Partial<Record<LanguageCode, string[]>> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "it", "with", "as", "was", "on", "are", "this"],
  es: ["el", "la", "de", "que", "y", "en", "los", "del", "las", "un", "por", "con", "una", "para", "es"],
  fr: ["le", "de", "et", "la", "les", "des", "en", "un", "une", "du", "que", "qui", "dans", "pour", "est"],
  de: ["der", "die", "und", "den", "das", "von", "ist", "des", "mit", "dem", "nicht", "auch", "eine", "als", "auf"],
  it: ["il", "di", "che", "la", "e", "per", "un", "in", "del", "una", "con", "non", "le", "si", "sono"],
  pt: ["de", "que", "os", "as", "do", "da", "em", "um", "para", "com", "nao", "uma", "dos", "por", "mais"],
  nl: ["de", "het", "een", "van", "en", "in", "is", "dat", "op", "te", "voor", "met", "zijn", "niet", "aan"],
  sv: ["och", "att", "det", "som", "en", "av", "for", "med", "den", "till", "har", "inte", "om", "ett", "pa"],
  da: ["og", "det", "at", "en", "til", "af", "for", "med", "den", "der", "er", "ikke", "har", "om", "pa"],
  no: ["og", "det", "som", "en", "til", "av", "for", "med", "den", "har", "ikke", "om", "et", "pa", "er"],
  fi: ["ja", "on", "ei", "se", "etta", "joka", "ovat", "han", "kuin", "mutta", "myos", "olla", "voi", "niin", "kun"],
  pl: ["nie", "sie", "jest", "que", "oraz", "przez", "jako", "tego", "dla", "ale", "juz", "tym", "jest", "byla", "przy"],
  cs: ["ale", "jako", "jsou", "jeho", "byl", "tak", "jen", "nebo", "pro", "podle", "kdy", "vsak", "tim", "jeste", "uz"],
  tr: ["bir", "ve", "bu", "icin", "ile", "olarak", "daha", "cok", "ama", "olan", "kadar", "sonra", "gibi", "her", "ise"],
  id: ["yang", "dan", "di", "dari", "untuk", "dengan", "pada", "ini", "itu", "tidak", "akan", "dalam", "juga", "adalah", "oleh"],
  vi: ["va", "cua", "cac", "trong", "cho", "khong", "duoc", "nguoi", "mot", "nhung", "den", "tai", "voi", "khi", "ban"],
  ro: ["si", "de", "in", "care", "pentru", "din", "cu", "este", "mai", "sau", "dar", "pe", "nu", "sunt", "fost"],
  hu: ["hogy", "nem", "egy", "az", "meg", "volt", "csak", "mar", "vagy", "mint", "ezt", "lehet", "amely", "szerint", "igy"],
};

/** Unicode script ranges that pin a language on sight. Ordered so the more
 *  specific Japanese kana test runs before the shared Han check. */
const SCRIPTS: { code: LanguageCode; re: RegExp }[] = [
  { code: "ja", re: /[぀-ゟ゠-ヿ]/ }, // hiragana / katakana
  { code: "ko", re: /[가-힯ᄀ-ᇿ]/ }, // hangul
  { code: "zh", re: /[一-鿿]/ },              // han
  { code: "el", re: /[Ͱ-Ͽ]/ },
  { code: "ar", re: /[؀-ۿ]/ },
  { code: "he", re: /[֐-׿]/ },
  { code: "hi", re: /[ऀ-ॿ]/ },
  { code: "th", re: /[฀-๿]/ },
];

/** Cyrillic is shared; these letters separate Ukrainian from Russian. */
const UK_MARKERS = /[іїєґ]/i;

export type Detection = { code: LanguageCode; confidence: number };

/**
 * Best-guess language for a block of text. Returns null when the text is too
 * short or no candidate wins clearly enough to act on.
 */
export function detectLanguage(raw: string | null | undefined): Detection | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 24) return null;

  // ── 1. Script ───────────────────────────────────────────────────────
  const sample = text.slice(0, 4000);
  for (const { code, re } of SCRIPTS) {
    const hits = sample.match(new RegExp(re.source, "g"))?.length ?? 0;
    // A few stray characters (a quoted name, a brand) shouldn't flip the whole
    // article; require the script to be a real presence in the text.
    if (hits >= 8 || hits / sample.length > 0.08) {
      return { code, confidence: Math.min(1, 0.7 + hits / sample.length) };
    }
  }
  const cyrillic = sample.match(/[Ѐ-ӿ]/g)?.length ?? 0;
  if (cyrillic >= 8 || cyrillic / sample.length > 0.08) {
    return { code: UK_MARKERS.test(sample) ? "uk" : "ru", confidence: 0.85 };
  }

  // ── 2. Latin stopwords ──────────────────────────────────────────────
  // Strip diacritics so the ASCII stopword lists match accented text.
  const words = sample
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length < 12) return null;

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  let best: { code: LanguageCode; score: number } | null = null;
  let runnerUp = 0;
  for (const [code, list] of Object.entries(STOPWORDS) as [LanguageCode, string[]][]) {
    let hits = 0;
    for (const sw of list) hits += counts.get(sw) ?? 0;
    const score = hits / words.length;
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { code, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // Needs both a real signal and a clear margin over the next-best language —
  // several of these languages share function words, and a coin-flip guess is
  // worse than staying quiet.
  if (!best || best.score < 0.045) return null;
  if (best.score < runnerUp * 1.35) return null;
  return { code: best.code, confidence: Math.min(1, best.score * 6) };
}
