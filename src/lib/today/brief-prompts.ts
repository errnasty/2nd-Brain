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
import { topicById } from "./topics";

const SHARED_RULES = [
  "Cite with the bracketed reference numbers exactly as supplied (e.g. [3]). Never invent a number.",
  "Never state a fact, figure or quote that is not in the supplied text. If the text is thin, say less.",
  "No section heading, no preamble, no sign-off — the page renders the heading. Start with the content.",
  "Plain Markdown. No code fences, no tables.",
];

function rules(lines: (string | false)[]): string {
  return [...lines, ...SHARED_RULES]
    .filter((l): l is string => Boolean(l))
    .map((l) => `- ${l}`)
    .join("\n");
}

/** The system prompt for one section. */
export function sectionSystemPrompt(section: PlannedSection, level: BriefLevel): string {
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
  "Separate items with a blank line.",
])}`;
  }

  if (section.kind === "topic") {
    const topic = section.topicId ? topicById(section.topicId) : null;
    const remit = topic
      ? `This desk covers ${topic.desk}.`
      : "This desk covers whatever did not fit the other desks — treat it as a short catch-all.";
    return `You are writing the "${section.label}" desk of my personal daily intelligence brief. ${remit}

${rules([
  "Open with one sentence of state-of-play: the through-line across today's items on this desk.",
  `Then up to ${cfg.topicBullets} bullets, one per distinct development, each ending with its bracketed reference number(s). One or two sentences each — the specific fact or claim, not a restatement of the headline.`,
  "Merge items covering the same event into one bullet with both numbers.",
  cfg.topicTension &&
    'If today\'s items disagree or cut against each other, add a final line starting "*Tension:*" naming the disagreement and citing both sides.',
  cfg.topicOpenQuestion &&
    'Close with a line starting "*Open question:*" — the thing today\'s items do not settle.',
  "If an item was clearly misfiled onto this desk, leave it out rather than stretching the desk's remit.",
])}`;
  }

  return `You are writing the QUICK CLEAR list that closes my personal daily brief: the items I can mark read without opening them.

${rules([
  "List only genuinely low-signal items: clickbait, press releases, product marketing, link roundups, and repeats of an event already covered elsewhere in the queue.",
  "One bullet each: a shortened title, its bracketed reference number, and a reason of at most eight words.",
  "Be conservative — when in doubt, leave it out. A wrongly-skipped article costs me more than a wrongly-kept one.",
  'If nothing qualifies, reply with exactly this line and nothing else: "Nothing obviously skippable today."',
])}`;
}

/**
 * Output ceilings per section kind. These are a LATENCY budget, not a style
 * preference: generation time scales with output length, and every section has
 * to finish inside the host's function window (~10s on Netlify). At a realistic
 * streaming rate these land in the mid single-digit seconds, which is why depth
 * levels buy more SECTIONS rather than longer ones — the brief gets several
 * times longer overall without any single request getting slower.
 */
const MAX_LEAD_TOKENS = 520;
const MAX_TOPIC_TOKENS = 420;
const MAX_SKIP_TOKENS = 320;

export function sectionMaxTokens(section: PlannedSection, level: BriefLevel): number {
  const cfg = BRIEF_LEVEL_CONFIG[level];
  if (section.kind === "lead") return Math.min(MAX_LEAD_TOKENS, 140 * cfg.leadPicks + 120);
  if (section.kind === "topic") return Math.min(MAX_TOPIC_TOKENS, 90 * cfg.topicBullets + 140);
  // Skip is a list of titles: ~24 tokens each, capped so a 60-item queue can't
  // turn the cheapest section into the longest one.
  return Math.min(MAX_SKIP_TOKENS, 24 * section.refs.length + 80);
}

/** The largest output any single section can ask for — the timeout guard rail. */
export const MAX_SECTION_TOKENS = Math.max(MAX_LEAD_TOKENS, MAX_TOPIC_TOKENS, MAX_SKIP_TOKENS);

export type BriefArticleInput = {
  /** The `[n]` this article is cited as. */
  n: number;
  title: string;
  feedTitle: string;
  /** Plain text (HTML already stripped); truncated here. */
  body: string;
};

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

/** One line of context above the article block: what window, how much queue. */
export function sectionPreamble(
  section: PlannedSection,
  opts: { windowLabel: string; totalCount: number; deskCount?: number },
): string {
  const scope =
    section.kind === "lead"
      ? `${section.refs.length} candidates drawn from ${opts.totalCount} unread articles`
      : section.kind === "topic"
        ? `${section.refs.length} of ${opts.deskCount ?? section.refs.length} items on this desk`
        : `${section.refs.length} unread articles, titles only`;
  return `[Briefing window: ${opts.windowLabel} · ${scope}]`;
}
