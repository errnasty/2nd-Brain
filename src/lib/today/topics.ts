/**
 * Topic desks for the Daily Brief.
 *
 * The brief used to hand the model one undifferentiated pile of unread
 * articles, which meant 1–3 items got real attention and everything else was
 * collapsed into "4 items on AI Tools". Grouping the queue into desks FIRST
 * lets the brief spend a bounded model call per desk, so geopolitics and AI
 * each get a proper write-up instead of a line in a cluster list.
 *
 * Classification is deliberately keyword-based, not model-based:
 *   - it costs nothing, so it can run on every page load (the plan endpoint);
 *   - it is deterministic, so the same unread set always produces the same
 *     desks and the same [n] numbering across the plan and every section call;
 *   - it never eats into the function time budget the model calls need.
 *
 * It is a heuristic and will misfile things. That's acceptable: each desk's
 * prompt is told what desk it is, so a stray item gets mentioned in passing
 * rather than derailing the section, and anything unclassifiable lands in
 * "Also in your queue".
 *
 * Client-safe: no db, no server-only imports (the Today tab renders the desk
 * labels in its focus picker).
 */

export type BriefTopic = {
  id: string;
  /** Section heading in the brief, and the label in the focus picker. */
  label: string;
  /** Handed to the model as the desk's remit so sections keep their lane. */
  desk: string;
  /** Distinctive terms — a single title hit is enough to file the article. */
  strong: string[];
  /** Ambient terms — meaningful in twos, never on their own. */
  weak: string[];
};

/** Fallback desk id for articles no desk claims. */
export const OTHER_TOPIC_ID = "other";
export const OTHER_TOPIC_LABEL = "Also in your queue";

/**
 * Desk order is the tie-break for equally-scored topics, so the two the brief
 * is expected to be strongest on — world affairs and AI — come first.
 */
export const BRIEF_TOPICS: BriefTopic[] = [
  {
    id: "geopolitics",
    label: "Geopolitics & World Affairs",
    desk: "state-level power: conflicts, diplomacy, alliances, sanctions, elections and the balance between major powers",
    strong: [
      "geopolitics",
      "geopolitical",
      "foreign policy",
      "diplomacy",
      "diplomatic",
      "sanctions",
      "ceasefire",
      "armistice",
      "nato",
      "united nations",
      "security council",
      "ukraine",
      "russia",
      "russian",
      "kremlin",
      "china",
      "chinese",
      "beijing",
      "taiwan",
      "israel",
      "gaza",
      "hamas",
      "hezbollah",
      "iran",
      "iranian",
      "north korea",
      "middle east",
      "venezuela",
      "sudan",
      "syria",
      "nigeria",
      "india",
      "pakistan",
      "european union",
      "brussels",
      "treaty",
      "summit",
      "g7",
      "g20",
      "brics",
      "coup",
      "invasion",
      "annexation",
      "airstrike",
      "missile strike",
      "drone strike",
      "warship",
      "military aid",
      "arms deal",
      "export controls",
      "trade war",
      "espionage",
      "ambassador",
      "geoeconomic",
      "sovereignty",
    ],
    weak: [
      "war",
      "president",
      "prime minister",
      "minister",
      "parliament",
      "election",
      "elections",
      "government",
      "border",
      "troops",
      "military",
      "defence",
      "defense",
      "alliance",
      "tariff",
      "tariffs",
      "immigration",
      "protests",
      "referendum",
    ],
  },
  {
    id: "ai",
    label: "AI & Machine Learning",
    desk: "AI capability, research, tooling, deployment and the economics around it",
    strong: [
      "artificial intelligence",
      "ai",
      "a i",
      "agi",
      "llm",
      "llms",
      "large language model",
      "large language models",
      "machine learning",
      "deep learning",
      "neural network",
      "neural networks",
      "transformer model",
      "gpt",
      "chatgpt",
      "claude",
      "gemini",
      "llama",
      "mistral",
      "qwen",
      "deepseek",
      "openai",
      "anthropic",
      "deepmind",
      "hugging face",
      "fine tuning",
      "fine tune",
      "prompt engineering",
      "retrieval augmented",
      "rag pipeline",
      "ai agent",
      "ai agents",
      "agentic",
      "copilot",
      "diffusion model",
      "stable diffusion",
      "midjourney",
      "sora",
      "embeddings",
      "superintelligence",
      "ai safety",
      "ai alignment",
      "model weights",
      "open weights",
      "inference cost",
      "tokens per second",
      "context window",
      "benchmarks",
      "hallucination",
      "hallucinations",
    ],
    weak: [
      "model",
      "models",
      "chatbot",
      "assistant",
      "automation",
      "algorithm",
      "dataset",
      "training",
      "training data",
      "inference",
      "nvidia",
      "gpu",
      "gpus",
      "tpu",
      "robotics",
      "autonomous",
      "generative",
      "prompt",
      "agents",
    ],
  },
  {
    id: "tech",
    label: "Technology & Engineering",
    desk: "software, systems, hardware and how things are actually built",
    strong: [
      "open source",
      "programming",
      "developer",
      "developers",
      "typescript",
      "javascript",
      "python",
      "rust",
      "golang",
      "kubernetes",
      "docker",
      "postgres",
      "postgresql",
      "sqlite",
      "database",
      "compiler",
      "framework",
      "runtime",
      "sdk",
      "github",
      "linux",
      "browser",
      "webassembly",
      "devops",
      "self hosted",
      "semiconductor",
      "semiconductors",
      "chipmaker",
      "foundry",
      "tsmc",
      "arm",
      "cloud provider",
      "aws",
      "azure",
      "data center",
      "data centre",
      "api",
      "latency",
      "architecture",
      "refactor",
      "engineering",
    ],
    weak: [
      "software",
      "app",
      "apps",
      "platform",
      "release",
      "launch",
      "update",
      "hardware",
      "device",
      "laptop",
      "iphone",
      "android",
      "apple",
      "google",
      "microsoft",
      "amazon",
      "meta",
      "chips",
      "silicon",
      "product",
      "beta",
    ],
  },
  {
    id: "markets",
    label: "Business & Markets",
    desk: "money: earnings, capital, macro conditions and corporate strategy",
    strong: [
      "earnings",
      "revenue",
      "profit",
      "ipo",
      "valuation",
      "stock",
      "stocks",
      "shares",
      "bond",
      "bonds",
      "yields",
      "inflation",
      "interest rates",
      "rate cut",
      "rate hike",
      "federal reserve",
      "central bank",
      "recession",
      "gdp",
      "unemployment",
      "hedge fund",
      "private equity",
      "venture capital",
      "funding round",
      "series a",
      "series b",
      "acquisition",
      "merger",
      "layoffs",
      "bankruptcy",
      "bitcoin",
      "ethereum",
      "stablecoin",
      "crypto",
      "commodity",
      "oil prices",
      "supply chain",
      "balance sheet",
      "capex",
      "market cap",
      "short seller",
    ],
    weak: [
      "economy",
      "economic",
      "market",
      "markets",
      "growth",
      "investors",
      "investment",
      "spending",
      "consumer",
      "jobs",
      "quarter",
      "deal",
      "billion",
      "startup",
      "funding",
      "prices",
      "wages",
    ],
  },
  {
    id: "policy",
    label: "Policy & Regulation",
    desk: "rules and their enforcement: legislation, regulators, courts and compliance",
    strong: [
      "regulation",
      "regulations",
      "regulator",
      "regulators",
      "regulatory",
      "antitrust",
      "monopoly",
      "lawsuit",
      "supreme court",
      "court ruling",
      "legislation",
      "congress",
      "senate",
      "eu ai act",
      "gdpr",
      "privacy law",
      "compliance",
      "ftc",
      "sec filing",
      "doj",
      "executive order",
      "subpoena",
      "injunction",
      "settlement",
      "copyright",
      "patent",
      "moratorium",
      "watchdog",
    ],
    weak: [
      "policy",
      "law",
      "laws",
      "legal",
      "court",
      "ban",
      "banned",
      "fine",
      "fined",
      "oversight",
      "hearing",
      "bill",
      "rules",
      "licence",
      "license",
      "audit",
    ],
  },
  {
    id: "security",
    label: "Security & Cyber",
    desk: "attacks, defences and the people running both",
    strong: [
      "cybersecurity",
      "cyberattack",
      "cyber attack",
      "ransomware",
      "malware",
      "data breach",
      "breached",
      "hackers",
      "hacked",
      "vulnerability",
      "vulnerabilities",
      "zero day",
      "exploit",
      "phishing",
      "botnet",
      "spyware",
      "backdoor",
      "encryption",
      "ddos",
      "credential stuffing",
      "supply chain attack",
      "threat actor",
      "cve",
    ],
    weak: [
      "security",
      "breach",
      "hack",
      "patch",
      "patched",
      "password",
      "passwords",
      "leak",
      "leaked",
      "incident",
      "firewall",
      "surveillance",
      "privacy",
    ],
  },
  {
    id: "science",
    label: "Science & Space",
    desk: "findings and instruments: physics, space, mathematics and the research frontier",
    strong: [
      "researchers",
      "scientists",
      "physics",
      "quantum",
      "quantum computing",
      "astronomy",
      "astrophysics",
      "nasa",
      "spacex",
      "satellite",
      "rocket launch",
      "mars",
      "lunar",
      "telescope",
      "particle",
      "nuclear fusion",
      "superconductor",
      "mathematics",
      "mathematician",
      "peer review",
      "preprint",
      "archaeology",
      "paleontology",
      "geology",
      "neuroscience",
    ],
    weak: [
      "study",
      "research",
      "discovery",
      "experiment",
      "laboratory",
      "university",
      "theory",
      "space",
      "orbit",
      "evolution",
      "climate model",
    ],
  },
  {
    id: "health",
    label: "Health & Bio",
    desk: "medicine, biology and the body: trials, treatments and public health",
    strong: [
      "clinical trial",
      "fda",
      "vaccine",
      "vaccines",
      "cancer",
      "tumour",
      "tumor",
      "disease",
      "outbreak",
      "pandemic",
      "epidemic",
      "mental health",
      "depression",
      "obesity",
      "diabetes",
      "alzheimer",
      "pharmaceutical",
      "biotech",
      "gene therapy",
      "crispr",
      "genome",
      "dna",
      "microbiome",
      "longevity",
      "nutrition",
      "antibiotic",
      "sleep quality",
    ],
    weak: [
      "health",
      "healthcare",
      "medical",
      "medicine",
      "patients",
      "doctors",
      "hospital",
      "therapy",
      "diagnosis",
      "drug",
      "drugs",
      "diet",
      "exercise",
      "wellness",
    ],
  },
  {
    id: "energy",
    label: "Climate & Energy",
    desk: "the physical system: emissions, energy supply, and the weather it produces",
    strong: [
      "climate change",
      "emissions",
      "carbon",
      "net zero",
      "decarbonisation",
      "decarbonization",
      "renewable",
      "renewables",
      "solar power",
      "wind power",
      "nuclear power",
      "power grid",
      "battery storage",
      "electric vehicle",
      "electric vehicles",
      "fossil fuel",
      "fossil fuels",
      "coal plant",
      "natural gas",
      "drilling",
      "heat wave",
      "heatwave",
      "wildfire",
      "wildfires",
      "drought",
      "flooding",
      "hurricane",
      "energy transition",
      "cop30",
      "cop31",
    ],
    weak: [
      "climate",
      "energy",
      "electricity",
      "weather",
      "temperature",
      "sustainability",
      "power plant",
      "storm",
      "flood",
      "emission",
      "green",
    ],
  },
  {
    id: "culture",
    label: "Culture & Ideas",
    desk: "how people live and think: media, education, sport, history and argument",
    strong: [
      "film",
      "movie",
      "television",
      "documentary",
      "album",
      "novel",
      "memoir",
      "poetry",
      "museum",
      "philosophy",
      "philosopher",
      "historian",
      "essay",
      "olympics",
      "world cup",
      "football",
      "basketball",
      "cricket",
      "fashion",
      "cuisine",
      "religion",
      "psychology",
      "sociology",
      "curriculum",
      "literacy",
    ],
    weak: [
      "culture",
      "society",
      "social",
      "book",
      "books",
      "author",
      "art",
      "music",
      "story",
      "interview",
      "career",
      "habits",
      "productivity",
      "education",
      "school",
      "students",
      "travel",
      "food",
      "sport",
      "sports",
    ],
  },
];

const TOPIC_BY_ID = new Map(BRIEF_TOPICS.map((t) => [t.id, t]));

// ── Desks the reader defines themselves ─────────────────────────────────

/**
 * The built-in desks are a general-interest newsroom's, and they will never be
 * anybody's exactly. A reader who follows Singapore, or semiconductor supply,
 * or one company, has no desk for it: those articles scatter across
 * Geopolitics, Markets and "Also in your queue" and never get written up as
 * the thing they actually are.
 *
 * A custom desk is the same object as a built-in one — a label, a remit, and
 * terms that claim an article — with two differences:
 *
 *   - every term the reader gives is STRONG, because they typed it on purpose.
 *     The weak/strong split exists to stop ambient words ("model", "market")
 *     from claiming articles, and a term somebody deliberately added is not
 *     ambient by definition;
 *   - a custom desk that clears the threshold WINS over any built-in that also
 *     clears it (see `classifyArticle`). "Singapore tightens chip export rules"
 *     scores well on Geopolitics too, and filing it there is exactly the
 *     outcome the reader added a Singapore desk to prevent.
 *
 * Ids are namespaced so a custom desk can never collide with a built-in one,
 * and so every consumer (settings, feedback rows, XP) can tell them apart
 * without a lookup.
 */
export const CUSTOM_DESK_PREFIX = "custom:";

/** Ceilings. Generous for a person, bounded for a prompt and a jsonb blob. */
export const MAX_CUSTOM_DESKS = 8;
export const MAX_CUSTOM_DESK_KEYWORDS = 30;
const MAX_DESK_LABEL_CHARS = 40;
const MAX_DESK_REMIT_CHARS = 240;
const MAX_KEYWORD_CHARS = 40;

export type CustomDesk = {
  /** `custom:<slug>` — namespaced so it can never collide with a built-in. */
  id: string;
  label: string;
  /** The desk's remit, handed to the model. Derived from the label when blank. */
  desk: string;
  /** Normalized match terms. Always at least one, or the desk is dropped. */
  keywords: string[];
};

export function isCustomDeskId(id: string): boolean {
  return id.startsWith(CUSTOM_DESK_PREFIX);
}

/**
 * Terms are matched against the same normalized, space-padded haystack the
 * built-in keywords are, so they have to go through the same transform:
 * "South-East Asia" and "south east asia" must become the same term, or the
 * one the reader typed with a hyphen would silently never match.
 */
export function normalizeKeyword(raw: string): string {
  return normalize(raw).trim().slice(0, MAX_KEYWORD_CHARS).trim();
}

/** Stable id for a desk label. Same label ⇒ same id, across devices. */
export function customDeskId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return CUSTOM_DESK_PREFIX + (slug || "desk");
}

/**
 * Validate whatever is sitting in the settings blob into desks the planner can
 * use. Never throws and never returns a half-formed desk: this runs on every
 * brief request, and a desk with no terms would silently claim nothing while
 * still costing a section.
 *
 * The label doubles as a term when the reader gave none that survived — a desk
 * called "Singapore" with an empty keyword box should still find Singapore.
 */
export function normalizeCustomDesks(v: unknown): CustomDesk[] {
  if (!Array.isArray(v)) return [];
  const out: CustomDesk[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Partial<CustomDesk> & { keywords?: unknown };
    const label = typeof d.label === "string" ? d.label.trim().slice(0, MAX_DESK_LABEL_CHARS) : "";
    if (!label) continue;
    const id =
      typeof d.id === "string" && isCustomDeskId(d.id) ? d.id.slice(0, 64) : customDeskId(label);
    if (seen.has(id)) continue;

    const terms = Array.isArray(d.keywords) ? d.keywords : [];
    const keywords: string[] = [];
    for (const t of terms) {
      if (typeof t !== "string") continue;
      const k = normalizeKeyword(t);
      if (k && !keywords.includes(k)) keywords.push(k);
      if (keywords.length >= MAX_CUSTOM_DESK_KEYWORDS) break;
    }
    if (keywords.length === 0) {
      const fromLabel = normalizeKeyword(label);
      if (!fromLabel) continue;
      keywords.push(fromLabel);
    }

    const remit =
      typeof d.desk === "string" && d.desk.trim()
        ? d.desk.trim().slice(0, MAX_DESK_REMIT_CHARS)
        : `${label} — anything in my queue that bears on it`;

    seen.add(id);
    out.push({ id, label, desk: remit, keywords });
    if (out.length >= MAX_CUSTOM_DESKS) break;
  }
  return out;
}

/**
 * A custom desk in the shape the classifier works with.
 *
 * Terms are re-normalized on the way through even though `normalizeCustomDesks`
 * already did it. The classifier matches against a normalized haystack, so a
 * term that skipped that transform silently matches NOTHING — a desk that looks
 * saved, looks followed, and quietly claims no articles. Re-running a regex
 * over at most a few dozen short strings is a much cheaper way to hold that
 * invariant than trusting every future caller to have gone through the
 * validator first.
 */
export function customDeskTopic(d: CustomDesk): BriefTopic {
  return {
    id: d.id,
    label: d.label,
    desk: d.desk,
    strong: d.keywords.map(normalizeKeyword).filter(Boolean),
    weak: [],
  };
}

/**
 * The desk list for one reader: their own desks first, then the built-ins.
 *
 * Order matters twice — it is the tie-break for equally-scored desks in
 * `classifyArticle`, and the tie-break for equally-sized buckets in
 * `groupByTopic` — and in both cases a desk somebody asked for should win a
 * tie against one the app assumed.
 */
export function resolveDesks(custom?: CustomDesk[] | null): BriefTopic[] {
  if (!custom || custom.length === 0) return BRIEF_TOPICS;
  return [...custom.map(customDeskTopic), ...BRIEF_TOPICS];
}

/** Desk for an id, including the synthetic "other" desk. */
export function topicLabel(id: string, desks: BriefTopic[] = BRIEF_TOPICS): string {
  if (id === OTHER_TOPIC_ID) return OTHER_TOPIC_LABEL;
  if (desks !== BRIEF_TOPICS) {
    const found = desks.find((t) => t.id === id);
    if (found) return found.label;
  }
  return TOPIC_BY_ID.get(id)?.label ?? id;
}

export function topicById(id: string, desks: BriefTopic[] = BRIEF_TOPICS): BriefTopic | null {
  if (desks !== BRIEF_TOPICS) {
    const found = desks.find((t) => t.id === id);
    if (found) return found;
  }
  return TOPIC_BY_ID.get(id) ?? null;
}

/** Field weights: a term in the headline says far more than one buried in the body. */
const TITLE_WEIGHT = 3;
const FEED_WEIGHT = 2;
const EXCERPT_WEIGHT = 1;
const STRONG = 3;
const WEAK = 1;

/**
 * Minimum score to claim an article. Calibrated so one strong headline term
 * (3×3=9) or a topical feed name (2×3=6) or two ambient headline terms (3+3=6)
 * files it, while a single strong term deep in the body (3) does not — body
 * text mentions Russia, GPUs and inflation in passing far too often.
 */
const MIN_SCORE = 5;

/** Only the first slice of body text is worth scanning — leads carry the topic. */
const EXCERPT_SCAN_CHARS = 600;

/**
 * Lowercase, strip punctuation to spaces, pad with spaces. Padding lets a
 * keyword be matched as `" term "`, which gives phrase-aware word-boundary
 * matching without per-keyword regex escaping: "AI-powered" and "(AI)" both
 * normalise to something containing " ai ".
 */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function hits(haystack: string, keywords: string[]): number {
  let n = 0;
  for (const k of keywords) {
    if (haystack.includes(` ${k} `)) n += 1;
  }
  return n;
}

export type ClassifiableArticle = {
  title: string;
  excerpt?: string | null;
  feedTitle?: string | null;
};

/** Per-desk score for one article. Exported for tests and for tuning. */
export function scoreTopics(
  a: ClassifiableArticle,
  desks: BriefTopic[] = BRIEF_TOPICS,
): Map<string, number> {
  const title = normalize(a.title ?? "");
  const feed = normalize(a.feedTitle ?? "");
  const excerpt = normalize((a.excerpt ?? "").slice(0, EXCERPT_SCAN_CHARS));
  const scores = new Map<string, number>();
  for (const t of desks) {
    const score =
      TITLE_WEIGHT * (STRONG * hits(title, t.strong) + WEAK * hits(title, t.weak)) +
      FEED_WEIGHT * (STRONG * hits(feed, t.strong) + WEAK * hits(feed, t.weak)) +
      EXCERPT_WEIGHT * (STRONG * hits(excerpt, t.strong) + WEAK * hits(excerpt, t.weak));
    if (score > 0) scores.set(t.id, score);
  }
  return scores;
}

/**
 * The single desk an article belongs to, or `"other"`. Highest score wins;
 * ties break by desk order (the reader's own desks, then world affairs, then
 * AI, …) so the result is stable.
 *
 * One asymmetry: among the desks that clear the threshold, a CUSTOM desk beats
 * every built-in regardless of score. A reader who adds a Singapore desk is
 * telling us where Singapore stories go, and "Singapore tightens chip export
 * rules to Beijing" scores higher on Geopolitics than on any three-term desk
 * ever could — so score alone would file it exactly where they added the desk
 * to stop it going.
 */
export function classifyArticle(
  a: ClassifiableArticle,
  desks: BriefTopic[] = BRIEF_TOPICS,
): string {
  const scores = scoreTopics(a, desks);
  const clearing = desks.filter((t) => (scores.get(t.id) ?? 0) >= MIN_SCORE);
  if (clearing.length === 0) return OTHER_TOPIC_ID;
  const custom = clearing.filter((t) => isCustomDeskId(t.id));
  const pool = custom.length > 0 ? custom : clearing;
  let bestId = pool[0].id;
  let best = scores.get(bestId) ?? 0;
  for (const t of pool) {
    const s = scores.get(t.id) ?? 0;
    if (s > best) {
      best = s;
      bestId = t.id;
    }
  }
  return bestId;
}

export type TopicBucket = {
  topicId: string;
  label: string;
  /** 1-based positions in the article list — the `[n]` refs used in the brief. */
  refs: number[];
};

/**
 * The desk each article belongs to, with every telling of one story landing on
 * the SAME desk.
 *
 * Classifying tellings independently is where cross-desk duplication came
 * from: "Fed holds rates" reads as Markets, "No change from the FOMC" reads as
 * Policy, and the brief then wrote the same event up twice under two headings,
 * each citing half the outlets. The cluster already knows they are one story,
 * so the desk is decided once per story and applied to all its members.
 *
 * The vote ignores "other" unless every member landed there — one telling with
 * a topical headline is better evidence of what a story IS than three wire
 * stubs that mention nothing. Ties go to the earliest member, which in queue
 * order is the hottest telling.
 */
function deskIdsFor(
  items: ClassifiableArticle[],
  desks: BriefTopic[],
  clusterIds?: (string | null | undefined)[],
): string[] {
  const raw = items.map((a) => classifyArticle(a, desks));
  if (!clusterIds) return raw;

  const votes = new Map<string, Map<string, number>>();
  const firstReal = new Map<string, string>();
  raw.forEach((id, i) => {
    const cluster = clusterIds[i];
    if (!cluster) return;
    let tally = votes.get(cluster);
    if (!tally) votes.set(cluster, (tally = new Map()));
    tally.set(id, (tally.get(id) ?? 0) + 1);
    if (id !== OTHER_TOPIC_ID && !firstReal.has(cluster)) firstReal.set(cluster, id);
  });

  const winner = new Map<string, string>();
  for (const [cluster, tally] of votes) {
    const real = [...tally.entries()].filter(([id]) => id !== OTHER_TOPIC_ID);
    const pool = real.length > 0 ? real : [...tally.entries()];
    const fallback = firstReal.get(cluster);
    let bestId = pool[0][0];
    let bestCount = pool[0][1];
    for (const [id, count] of pool) {
      // Strictly greater, so a tie keeps the earliest member's desk — and when
      // that member was unclassifiable, the first one that wasn't.
      if (count > bestCount || (count === bestCount && id === fallback && bestId !== fallback)) {
        bestId = id;
        bestCount = count;
      }
    }
    winner.set(cluster, bestId);
  }

  return raw.map((id, i) => {
    const cluster = clusterIds[i];
    return cluster ? (winner.get(cluster) ?? id) : id;
  });
}

/**
 * Group articles into desks, ordered so the desks the user said they care about
 * come first, then the busiest ones. `refs` are 1-based indices into `items`,
 * matching the `[n]` numbering the brief cites, so every section can quote
 * numbers from the same map.
 *
 * "other" is always last: it exists to account for the queue, not to lead it.
 *
 * Pass `clusterIds` (parallel to `items`) to keep every telling of one story on
 * one desk — see `deskIdsFor`. Pass `desks` to include the reader's own.
 */
export function groupByTopic(
  items: ClassifiableArticle[],
  opts: {
    priority?: string[];
    desks?: BriefTopic[];
    clusterIds?: (string | null | undefined)[];
  } = {},
): TopicBucket[] {
  const priority = opts.priority ?? [];
  const desks = opts.desks ?? BRIEF_TOPICS;
  const byTopic = new Map<string, number[]>();
  deskIdsFor(items, desks, opts.clusterIds).forEach((id, i) => {
    const refs = byTopic.get(id);
    if (refs) refs.push(i + 1);
    else byTopic.set(id, [i + 1]);
  });

  const order = new Map(desks.map((t, i) => [t.id, i]));
  return [...byTopic.entries()]
    .map(([topicId, refs]) => ({ topicId, label: topicLabel(topicId, desks), refs }))
    .sort((a, b) => {
      if (a.topicId === OTHER_TOPIC_ID) return 1;
      if (b.topicId === OTHER_TOPIC_ID) return -1;
      const pa = priority.indexOf(a.topicId);
      const pb = priority.indexOf(b.topicId);
      if (pa !== pb) {
        if (pa < 0) return 1;
        if (pb < 0) return -1;
        return pa - pb;
      }
      if (a.refs.length !== b.refs.length) return b.refs.length - a.refs.length;
      return (order.get(a.topicId) ?? 99) - (order.get(b.topicId) ?? 99);
    });
}
