/**
 * Prompts and input assembly for one section of the Daily Brief.
 *
 * One module per concern: `brief-plan.ts` decides WHICH sections exist and
 * which articles each may cite; this decides what each section is asked to
 * write, and how much room it gets. Kept out of the route file because Next.js
 * route modules can only export their handlers — and because prompt shape is
 * worth unit-testing.
 *
 * Every prompt here shares three constraints, all of them load-bearing:
 *   - cite the supplied `[n]` numbers and never invent one, so the brief's
 *     citations always resolve against the client's source map;
 *   - never state a fact that isn't in the supplied text;
 *   - emit no section heading and no preamble — the Today tab renders the
 *     heading itself, so a model-written one would show up twice.
 */

import type { BriefLevel, PlannedSection } from "./brief-plan";
import { BRIEF_LEVEL_CONFIG } from "./brief-plan";
import { topicById, topicLabel, type BriefTopic } from "./topics";

const SHARED_RULES = [
  "Cite with the bracketed reference numbers exactly as supplied (e.g. [3]). Never invent a number.",
  "Never state a fact, figure or quote that is not in the supplied text. If the text is thin, say less.",
  "No section heading, no preamble, no sign-off — the page renders the heading. Start with the content.",
  "Plain Markdown. No code fences, no tables.",
];

function rules(lines: (string | false | undefined)[]): string {
  return [...lines, ...SHARED_RULES]
    .filter((l): l is string => Boolean(l))
    .map((l) => `- ${l}`)
    .join("\n");
}

/**
 * Whether this section has any story covered by more than one outlet. Used to
 * add the corroboration rules ONLY when they apply — a prompt full of
 * instructions about a situation that isn't present is instructions the model
 * has to spend attention discarding.
 */
function hasStories(section: PlannedSection): boolean {
  return Boolean(section.stories && section.stories.length > 0);
}

/**
 * What the section knows beyond its own articles.
 *
 * Both of these are context the model can only act on if it's TOLD, and both
 * change what a good section looks like — so they gate their own rules rather
 * than being permanently in the prompt. A rule about continuing stories, in a
 * brief where nothing is continuing, is a rule the model spends attention
 * discarding.
 */
export type SectionContext = {
  /** Articles the reader already went through today (background, not refs). */
  readContext?: boolean;
  /** Stories this brief has covered before — see `story-memory.ts`. */
  continuing?: boolean;
  /**
   * An earlier section of THIS brief already wrote some of this desk's
   * material up, and it has been removed from the list below.
   *
   * The rule exists because removal alone is not quite enough: a desk handed
   * eight items where its biggest story is conspicuously missing will often
   * reach for it anyway from memory of the day, or open with a state-of-play
   * sentence about a story it can no longer cite. Saying plainly that the
   * story is elsewhere in the brief turns that into what it should be — a
   * clause of context, or nothing at all.
   */
  covered?: boolean;
  /** The reader's desk list, so a custom desk resolves to its own label. */
  desks?: BriefTopic[];
};

/** The system prompt for one section. */
export function sectionSystemPrompt(
  section: PlannedSection,
  level: BriefLevel,
  ctx: SectionContext = {},
): string {
  const cfg = BRIEF_LEVEL_CONFIG[level];

  if (section.kind === "lead") {
    return `You are the editor of my personal daily intelligence brief. I already get a generic news digest by email, so do not summarise everything — this section is THE LEAD: the few items in my queue that genuinely deserve my attention today.

${rules([
  `Choose the ${cfg.leadPicks} strongest items from the candidates below. Fewer is fine if fewer are worth it; never pad.`,
  "Open each item with a bold one-line claim about what is actually new — not the original headline reworded — followed by its bracketed reference number.",
  `Then ${cfg.leadSentences} sentences: what happened, what is genuinely new or surprising about it, and why it matters to someone tracking this space.`,
  cfg.leadWatch &&
    'End each item with a separate line starting "*Watch:*" naming the specific, checkable thing that would confirm or kill the story.',
  "Prefer analysis over recap. If two candidates cover the same event, treat them as one item and cite both numbers.",
  hasStories(section) &&
    "Some references are marked as the same story carried by several outlets. Write ONE item for such a story, citing every one of its numbers — the number of outlets carrying it is itself part of why it leads.",
  hasStories(section) &&
    'Where outlets on the same story emphasise different things, say so in a clause — "the FT frames it as X, Reuters as Y" — rather than averaging them into one bland sentence.',
  ctx.continuing &&
    "Some stories are marked as ones I was briefed on before. Do not introduce those from scratch — open with what has CHANGED since, and say plainly if the answer is very little.",
  ctx.readContext &&
    "A short list of pieces I have already read today is supplied for background. Never cite them — they have no reference number. Use them to avoid telling me what I know, and to build on it where today's items take it further.",
  "Separate items with a blank line.",
])}`;
  }

  if (section.kind === "topic") {
    const topic = section.topicId ? topicById(section.topicId, ctx.desks) : null;
    const remit = topic
      ? `This desk covers ${topic.desk}.`
      : "This desk covers whatever did not fit the other desks — treat it as a short catch-all.";
    return `You are writing the "${section.label}" desk of my personal daily intelligence brief. ${remit}

${rules([
  "Open with one sentence of state-of-play: the through-line across today's items on this desk.",
  `Then up to ${cfg.topicBullets} bullets, one per distinct development, each ending with its bracketed reference number(s). One or two sentences each — the specific fact or claim, not a restatement of the headline.`,
  "Merge items covering the same event into one bullet with both numbers.",
  hasStories(section) &&
    "References marked as one story are the same event: one bullet, all their numbers. Note how many outlets carried it when that is the notable part.",
  cfg.topicTension &&
    'If today\'s items disagree or cut against each other — including two outlets on the SAME story reporting it differently — add a final line starting "*Tension:*" naming the disagreement and citing both sides.',
  cfg.topicOpenQuestion &&
    'Close with a line starting "*Open question:*" — the thing today\'s items do not settle.',
  ctx.continuing &&
    "Stories marked as previously briefed are not new to me. Lead those bullets with the development, not the background.",
  ctx.readContext &&
    "Pieces I have already read today are listed for background only. Never cite them — they have no reference number — and don't spend a bullet retelling one.",
  ctx.covered &&
    "Stories the lead already covered have been removed from this desk's list. They are elsewhere in this brief, so do not write them up again or reach for them from memory — a single clause referring back is the most they are worth here.",
  "If an item was clearly misfiled onto this desk, leave it out rather than stretching the desk's remit.",
])}`;
  }

  if (section.kind === "external") {
    return `You are writing the closing section of my personal daily intelligence brief. These are big stories from the wider news world that my own feeds did NOT carry today — my blind spots, not my queue.

${rules([
  "One bullet per story, each ending with its bracketed reference (e.g. [E2]). These use E-numbers because they are not in my queue — never cite a plain number in this section.",
  "One or two sentences: what the story is, and why it is significant enough that not seeing it is worth knowing about.",
  "You have only headlines here, no article text. Say what the headline supports and nothing beyond it — do not infer detail, causes or consequences you were not given.",
  "Lead with the story that most plausibly matters to someone following my desks; drop anything that is celebrity, sport or human interest.",
  "Open with a single short clause framing these as gaps in my coverage, not as news I already have.",
])}`;
  }

  return `You are writing the QUICK CLEAR list that closes my personal daily brief: the items I can mark read without opening them.

${rules([
  "List only genuinely low-signal items: clickbait, press releases, product marketing, link roundups, and repeats of an event already covered elsewhere in the queue.",
  "One bullet each: a shortened title, its bracketed reference number, and a reason of at most eight words.",
  hasStories(section) &&
    "References marked as the same story are duplicate coverage. Keep the fullest telling out of the list and put the rest in it, reason \"already covered by [n]\".",
  ctx.covered &&
    "Everything the rest of this brief wrote up has already been removed from this list, so never say an item is \"covered above\" — what is in front of you is only what nothing else touched.",
  "Be conservative — when in doubt, leave it out. A wrongly-skipped article costs me more than a wrongly-kept one.",
  'If nothing qualifies, reply with exactly this line and nothing else: "Nothing obviously skippable today."',
])}`;
}

/**
 * Output ceilings per section kind. Still a latency budget rather than a style
 * preference — generation time scales with output length — but a much less
 * severe one than before. These were set so a section finished inside a ~10s
 * serverless window; Railway allows a streaming response to run for 15 minutes,
 * so the ceiling can now be set by how much a reader actually wants in one
 * section instead of by how fast the host pulls the plug.
 *
 * Raised roughly 60%, which is what "the brief feels thin" was really about.
 * Depth levels still buy more SECTIONS as well as longer ones: sections stream
 * independently, so more of them means text on screen sooner.
 */
const MAX_LEAD_TOKENS = 850;
const MAX_TOPIC_TOKENS = 700;
const MAX_SKIP_TOKENS = 480;
const MAX_EXTERNAL_TOKENS = 500;

export function sectionMaxTokens(section: PlannedSection, level: BriefLevel): number {
  const cfg = BRIEF_LEVEL_CONFIG[level];
  if (section.kind === "lead") return Math.min(MAX_LEAD_TOKENS, 140 * cfg.leadPicks + 120);
  if (section.kind === "topic") return Math.min(MAX_TOPIC_TOKENS, 90 * cfg.topicBullets + 140);
  // Headlines in, two sentences out per story — the cheapest section there is.
  if (section.kind === "external") {
    return Math.min(MAX_EXTERNAL_TOKENS, 50 * (section.externals?.length ?? 0) + 80);
  }
  // Skip is a list of titles: ~24 tokens each, capped so a 120-item queue can't
  // turn the cheapest section into the longest one.
  return Math.min(MAX_SKIP_TOKENS, 24 * section.refs.length + 80);
}

/** The largest output any single section can ask for — the timeout guard rail. */
export const MAX_SECTION_TOKENS = Math.max(
  MAX_LEAD_TOKENS,
  MAX_TOPIC_TOKENS,
  MAX_SKIP_TOKENS,
  MAX_EXTERNAL_TOKENS,
);

export type BriefArticleInput = {
  /** The `[n]` this article is cited as. */
  n: number;
  title: string;
  feedTitle: string;
  /** Plain text (HTML already stripped); truncated here. */
  body: string;
};

/**
 * The "these refs are one story" block.
 *
 * Stated as plain lines above the articles rather than woven into each entry,
 * because the relationship is between refs — putting "also see [7], [12]" on
 * [3] and the mirror of it on [7] says the same thing three times and invites
 * the model to write the story up once per mention.
 */
export function storyBlock(section: PlannedSection): string {
  const groups = section.stories ?? [];
  if (groups.length === 0) return "";
  const lines = groups.map((g) => {
    const refs = g.refs.map((n) => `[${n}]`).join(" ");
    return `- ${refs} — one story, ${g.sourceCount} outlets`;
  });
  return `Same-story groups (each group is ONE development, told by several outlets):\n${lines.join("\n")}`;
}

/**
 * The "you already read these" block.
 *
 * Titles and outlets only, and explicitly unnumbered. The numbering is the
 * whole reason for the separation: every `[n]` in a section resolves against
 * the client's source map, so background material that could be mistaken for a
 * ref would produce citations pointing at the wrong article. Making it visibly
 * a different KIND of line — no bracket, no number — is cheaper insurance than
 * a rule telling the model not to cite them, and it carries both.
 */
/**
 * The "you have seen these before" block.
 *
 * Keyed by ref, and stated once per ref rather than woven into the article
 * entries, for the same reason `storyBlock` is: a relationship stated beside
 * the article it belongs to gets restated in the prose, and the point here is
 * for the model to write LESS background, not to mention the history.
 */
export function continuityBlock(section: PlannedSection): string {
  const refs = section.continuing ?? [];
  if (refs.length === 0) return "";
  const lines = refs.map((c) => `- [${c.ref}] — I was first briefed on this ${c.since}`);
  return `Already briefed (report what has changed; do not introduce these from scratch):\n${lines.join("\n")}`;
}

export function readContextBlock(items: { title: string; feedTitle: string }[]): string {
  if (items.length === 0) return "";
  const lines = items.map((a) => `- (${a.feedTitle}) ${a.title}`);
  return `Already read today (background only — these have no reference number and must never be cited):\n${lines.join("\n")}`;
}

/**
 * The article block for one section. Skip sections get titles only — deciding
 * "is this clickbait" needs the headline, not the body — which is what makes
 * covering the whole queue in one small call affordable.
 */
export function sectionArticleBlock(
  section: PlannedSection,
  items: BriefArticleInput[],
  level: BriefLevel,
): string {
  const bodyChars = BRIEF_LEVEL_CONFIG[level].bodyChars;
  return items
    .map((a) => {
      const head = `[${a.n}] (${a.feedTitle}) ${a.title}`;
      if (section.kind === "skip") return head;
      const body = a.body.length > bodyChars ? `${a.body.slice(0, bodyChars)}…` : a.body;
      return body ? `${head}\n${body}` : head;
    })
    .join("\n\n");
}

/**
 * The block for the external section: headlines only, in their own `[E n]`
 * namespace. There is no body text to give — these are stories from outside the
 * user's subscriptions, and the app has deliberately not fetched them.
 */
export function externalBlock(section: PlannedSection, desks?: BriefTopic[]): string {
  return (section.externals ?? [])
    .map((e) => {
      const outlet = e.outlet ? ` (${e.outlet})` : "";
      const desk = e.topicId ? ` · desk: ${topicLabel(e.topicId, desks)}` : "";
      const spread = e.sourceCount > 1 ? ` · ${e.sourceCount} outlets` : "";
      return `[E${e.n}]${outlet} ${e.title}${desk}${spread}`;
    })
    .join("\n");
}

/** One line of context above the article block: what window, how much queue. */
export function sectionPreamble(
  section: PlannedSection,
  opts: { windowLabel: string; totalCount: number; deskCount?: number; scannedCount?: number },
): string {
  if (section.kind === "external") {
    return `[Stories from the wider news world in the last day that your own feeds did not carry · ${section.externals?.length ?? 0} of them]`;
  }
  // The scanned count is worth stating on the lead: "10 candidates from 110"
  // reads as a shortlist of a small pile, where "10 candidates from 110, drawn
  // from 640 scanned" tells the model what a candidate actually survived.
  const pool =
    opts.scannedCount && opts.scannedCount > opts.totalCount
      ? `${opts.totalCount} articles selected from ${opts.scannedCount} unread`
      : `${opts.totalCount} unread articles`;
  const scope =
    section.kind === "lead"
      ? `${section.refs.length} candidates drawn from ${pool}`
      : section.kind === "topic"
        ? `${section.refs.length} of ${opts.deskCount ?? section.refs.length} items on this desk`
        : `${section.refs.length} articles no other section covered, titles only`;
  return `[Briefing window: ${opts.windowLabel} · ${scope} · ranked by how widely each story is being covered]`;
}
