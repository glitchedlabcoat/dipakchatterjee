// instrumentation.ts
//
// Render's production logs showed repeated V8 "JavaScript heap out of
// memory" aborts (exit 134) with no request context attached, just a
// native stack trace of addresses. Neither hook here can prevent that
// abort (it's a fatal, non-catchable V8 event, not a JS exception), but
// they leave a trail so the next incident is diagnosable instead of a
// blank restart in the log.

export async function register() {
  // Dynamically imported (not imported at module scope) so Turbopack's
  // Edge Runtime bundle never has to statically resolve process.memoryUsage,
  // which doesn't exist there — see instrumentation-node.ts.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMemoryLogger } = await import("./instrumentation-node");
    startMemoryLogger();
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routeType: string }
) {
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  console.error(
    `[onRequestError] ${context.routeType} ${request.method} ${request.path} — ${message}${digest ? ` (digest ${digest})` : ""}`
  );
}
