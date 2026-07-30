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

/** Desk for an id, including the synthetic "other" desk. */
export function topicLabel(id: string): string {
  if (id === OTHER_TOPIC_ID) return OTHER_TOPIC_LABEL;
  return TOPIC_BY_ID.get(id)?.label ?? id;
}

export function topicById(id: string): BriefTopic | null {
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
export function scoreTopics(a: ClassifiableArticle): Map<string, number> {
  const title = normalize(a.title ?? "");
  const feed = normalize(a.feedTitle ?? "");
  const excerpt = normalize((a.excerpt ?? "").slice(0, EXCERPT_SCAN_CHARS));
  const scores = new Map<string, number>();
  for (const t of BRIEF_TOPICS) {
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
 * ties break by desk order (world affairs, then AI, …) so the result is stable.
 */
export function classifyArticle(a: ClassifiableArticle): string {
  const scores = scoreTopics(a);
  let bestId = OTHER_TOPIC_ID;
  let best = 0;
  for (const t of BRIEF_TOPICS) {
    const s = scores.get(t.id) ?? 0;
    if (s > best) {
      best = s;
      bestId = t.id;
    }
  }
  return best >= MIN_SCORE ? bestId : OTHER_TOPIC_ID;
}

export type TopicBucket = {
  topicId: string;
  label: string;
  /** 1-based positions in the article list — the `[n]` refs used in the brief. */
  refs: number[];
};

/**
 * Group articles into desks, ordered so the desks the user said they care about
 * come first, then the busiest ones. `refs` are 1-based indices into `items`,
 * matching the `[n]` numbering the brief cites, so every section can quote
 * numbers from the same map.
 *
 * "other" is always last: it exists to account for the queue, not to lead it.
 */
export function groupByTopic(
  items: ClassifiableArticle[],
  opts: { priority?: string[] } = {},
): TopicBucket[] {
  const priority = opts.priority ?? [];
  const byTopic = new Map<string, number[]>();
  items.forEach((a, i) => {
    const id = classifyArticle(a);
    const refs = byTopic.get(id);
    if (refs) refs.push(i + 1);
    else byTopic.set(id, [i + 1]);
  });

  const order = new Map(BRIEF_TOPICS.map((t, i) => [t.id, i]));
  return [...byTopic.entries()]
    .map(([topicId, refs]) => ({ topicId, label: topicLabel(topicId), refs }))
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
