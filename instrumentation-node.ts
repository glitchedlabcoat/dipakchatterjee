// Split out of instrumentation.ts so Turbopack's Edge Runtime bundle
// never has to statically see process.memoryUsage() — that API doesn't
// exist there, even though instrumentation.ts's register() only ever
// dynamically imports this module under the Node.js runtime.

export function startMemoryLogger() {
  const INTERVAL_MS = 15 * 60 * 1000;
  setInterval(() => {
    const m = process.memoryUsage();
    const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
    console.log(
      `[memory] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB`
    );
  }, INTERVAL_MS).unref();
}
