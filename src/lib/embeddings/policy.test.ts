import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deservesEmbeddingSql, EMBEDDING_POLICY_SUMMARY } from "./policy";
import { RETENTION_DAYS } from "@/lib/feeds/retention";

const render = (q: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(q).sql;

describe("deservesEmbeddingSql", () => {
  const text = render(deservesEmbeddingSql("a"));

  it("keeps a vector for every way a user can signal they care", () => {
    for (const signal of ["a.starred", "a.read_later", "a.read_status <> 'unread'"]) {
      expect(text, signal).toContain(signal);
    }
    expect(text).toContain("directory_items");
  });

  it("keeps a vector for the rolling retention window", () => {
    expect(text).toContain(`interval '${RETENTION_DAYS} days'`);
  });

  it("scopes the Directory lookup to the same user", () => {
    // Without this an article saved by one user would keep another user's
    // vector alive — and on a shared deployment, leak that it exists.
    expect(text).toContain("di.user_id = a.user_id");
  });

  it("respects the alias it is given", () => {
    expect(render(deservesEmbeddingSql("art"))).toContain("art.starred");
    expect(render(deservesEmbeddingSql("art"))).not.toContain("a.starred");
  });
});

// The backfill CREATES vectors where the policy holds; the expiry DELETES them
// where it does not. If those two predicates differ by a single row, that row is
// embedded, expired, re-embedded, expired… forever — a loop that costs a paid
// provider call every cycle and never converges. The only defence is that both
// are the same expression, so this asserts they are.
describe("backfill and expiry are exact complements", () => {
  const backfill = readFileSync(resolve(process.cwd(), "src/lib/embeddings/backfill.ts"), "utf8");

  it("the backfill filters on the policy, not a copy of it", () => {
    const articleQuery = backfill.slice(
      backfill.indexOf("select a.id, a.title, a.excerpt, a.full_text"),
      backfill.indexOf("as unknown as ArticleRow[]"),
    );
    expect(articleQuery).toContain("${deservesEmbeddingSql(");
    expect(articleQuery).toContain("e.id is null");
  });

  it("the expiry is the negation of the same call, not a second predicate", () => {
    const expiry = backfill.slice(
      backfill.indexOf("export async function expireStaleArticleEmbeddings"),
      backfill.indexOf("/** Embed a single user note inline"),
    );
    expect(expiry).toContain("not ${deservesEmbeddingSql(");
    // A hand-written second copy is exactly what must not appear.
    expect(expiry).not.toContain("a.starred");
    expect(expiry).not.toContain("read_status");
  });

  it("the SQL operator files keep a faithful copy of the predicate", () => {
    // These cannot import TypeScript, so they carry a copy. Drift here means an
    // operator run deletes something the app would have kept.
    for (const file of [
      "supabase/expire_embeddings.sql",
      "supabase/migrations/0038_expire_article_embeddings.sql",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      const body = src.replace(/--[^\n]*/g, ""); // ignore the prose
      for (const clause of [
        "a.starred",
        "a.read_later",
        "a.read_status <> 'unread'",
        `interval '${RETENTION_DAYS} days'`,
        "di.user_id = a.user_id",
      ]) {
        expect(body, `${file} is missing ${clause}`).toContain(clause);
      }
    }
  });
});

describe("EMBEDDING_POLICY_SUMMARY", () => {
  it("states the window the predicate actually uses", () => {
    expect(EMBEDDING_POLICY_SUMMARY).toContain(`${RETENTION_DAYS} days`);
  });
});
