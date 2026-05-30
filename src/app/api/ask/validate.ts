// Pure, DB-free helpers for the Ask route so they can be unit-tested without
// spinning up Supabase / the AI SDK.

export type AskBody = {
  question?: unknown;
  history?: unknown;
  model?: unknown;
};

export type ValidatedAsk =
  | { ok: true; question: string }
  | { ok: false; status: number; error: string };

/**
 * Zero-token safety gate. Rejects missing/empty/whitespace-only questions and
 * non-object bodies with a 400 BEFORE any DB or AI SDK work, so a bad request
 * never opens a stream that the proxy would later kill with an HTML 504.
 */
export function validateAskBody(body: unknown): ValidatedAsk {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Invalid request body" };
  }
  const q = (body as AskBody).question;
  if (typeof q !== "string") {
    return { ok: false, status: 400, error: "Missing question" };
  }
  const question = q.trim();
  if (question.length === 0) {
    return { ok: false, status: 400, error: "Empty question" };
  }
  return { ok: true, question };
}

export class TimeoutError extends Error {
  constructor(message = "Timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a timeout. If `ms` elapses first, reject with
 * TimeoutError so the caller can return a clean JSON error instead of letting
 * the request hang until the serverless proxy fires an HTML inactivity 504.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
