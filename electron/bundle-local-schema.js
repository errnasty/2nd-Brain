// Turns the drizzle-kit-generated DDL into a bundled TS string the desktop app
// applies to PGlite on first launch. Run via `npm run db:local-schema`.
const fs = require("fs");
const path = require("path");

const drizzleDir = path.join(__dirname, "..", "drizzle");
const outFile = path.join(__dirname, "..", "src", "lib", "db", "local-schema.ts");

const gen = fs.readdirSync(drizzleDir).find((f) => f.endsWith("_local_schema.sql"));
if (!gen) {
  console.error("No *_local_schema.sql found in drizzle/. Run drizzle-kit generate --name local_schema first.");
  process.exit(1);
}
const sql = fs.readFileSync(path.join(drizzleDir, gen), "utf8");
if (sql.includes("`") || sql.includes("${")) {
  console.error("SQL contains a backtick or ${ — cannot embed as a template literal safely.");
  process.exit(1);
}
const header =
  "// AUTO-GENERATED from src/lib/db/schema.ts via drizzle-kit (desktop local schema).\n" +
  "// Applied once to the embedded PGlite database on first desktop launch.\n" +
  "// Regenerate: npm run db:local-schema\n\n";
fs.writeFileSync(outFile, `${header}export const LOCAL_SCHEMA_SQL = \`\n${sql}\n\`;\n`);

// Keep the drizzle/ migration dir clean (cloud uses supabase/migrations).
fs.rmSync(path.join(drizzleDir, gen));
fs.rmSync(path.join(drizzleDir, "meta"), { recursive: true, force: true });
console.log("Wrote", path.relative(path.join(__dirname, ".."), outFile));
