// tests/unit/register-aliases.mjs
//
// Lets `node --test` load app modules that use the tsconfig "@/*" path
// alias (Node strips the TypeScript types itself). Loaded with --import;
// see the "test" script in package.json.
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootUrl = pathToFileURL(path.resolve(import.meta.dirname, "../..") + path.sep).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Packages without an "exports" map (e.g. next/server, next/cache) need
    // the file extension under Node's ESM rules; Next's bundler adds it.
    if (/^(?:next|react)\/[\w/-]+$/.test(specifier)) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.js`, context);
      }
    }
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = new URL(specifier.slice(2), rootUrl).href;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      try {
        return nextResolve(candidate, context);
      } catch {
        // try the next extension
      }
    }
    return nextResolve(specifier, context);
  },
});
