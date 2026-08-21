import { NextResponse } from "next/server";

/**
 * Liveness probe for platform healthchecks (Railway's `healthcheckPath`, and
 * any load balancer that wants one).
 *
 * Deliberately touches nothing external — no Supabase, no Postgres. A probe
 * that failed on a cold pooler connection would roll back a deploy that is in
 * fact serving fine; all the platform needs to know is that the Node process
 * is up and routing. It is excluded from the auth middleware matcher, so it
 * answers 200 rather than redirecting an unauthenticated prober to /login.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    runtime: process.env.APP_RUNTIME ?? "cloud",
  });
}
