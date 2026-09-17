import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Operator scripts under supabase/ get pasted into whatever is to hand — psql,
// the Supabase SQL editor, `supabase db push`. Those differ in one way that
// breaks scripts silently until someone hits it:
//
//   COMMIT (or ROLLBACK) inside a DO block is legal ONLY when nothing has
//   already opened a transaction. psql in autocommit runs the DO block as its
//   own top-level statement, so it works. The SQL editor wraps statements in a
//   transaction, so the same script dies with:
//
//     ERROR: 2D000: invalid transaction termination
//     CONTEXT: PL/pgSQL function inline_code_block line N at COMMIT
//
// purge_backlog.sql shipped with exactly that and only failed for the person
// running it in the dashboard. A batching script must therefore be one
// self-contained statement per batch, re-run until it reports nothing left —
// never a loop that commits between iterations.

const DIR = join(process.cwd(), "supabase");

function sqlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sqlFiles(full);
    return e.name.endsWith(".sql") ? [full] : [];
  });
}

/** DO $tag$ … $tag$ bodies, with the line the block starts on. */
function doBlocks(src: string): Array<{ body: string; line: number }> {
  const out: Array<{ body: string; line: number }> = [];
  const re = /\bdo\s+\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/gi;
  for (const m of src.matchAll(re)) {
    out.push({ body: m[2], line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Strip `--` line comments so prose about COMMIT does not trip the check. */
const stripComments = (s: string) => s.replace(/--[^\n]*/g, "");

describe("supabase/*.sql runs in any client", () => {
  const files = sqlFiles(DIR);

  it("finds the scripts", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no DO block terminates its own transaction", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const { body, line } of doBlocks(src)) {
        const code = stripComments(body);
        const bad = /^\s*(commit|rollback)\s*;/im.exec(code);
        if (bad) {
          offenders.push(
            `${relative(process.cwd(), file)}:${line} → ${bad[1].toUpperCase()} inside a DO block`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the detector recognises the shape it guards against", () => {
    const sample = "do $$\nbegin\n  loop\n    commit;\n  end loop;\nend\n$$;";
    const [block] = doBlocks(sample);
    expect(block).toBeTruthy();
    expect(/^\s*commit\s*;/im.test(stripComments(block.body))).toBe(true);
  });

  it("does not flag a DO block that merely mentions commit in a comment", () => {
    const sample = "do $$\nbegin\n  -- no commit here, deliberately\n  perform 1;\nend\n$$;";
    const [block] = doBlocks(sample);
    expect(/^\s*commit\s*;/im.test(stripComments(block.body))).toBe(false);
  });
});
