// tests/unit/helpers/mock-module.ts
//
// mock.module() with Node 24's `exports` option. @types/node 22 (this
// repo's version) only types the older `namedExports`, which Node 24
// still accepts but warns is deprecated.
import { mock } from "node:test";

export function mockModule(specifier: string, exports: Record<string, unknown>): void {
  mock.module(specifier, { exports } as unknown as Parameters<typeof mock.module>[1]);
}
