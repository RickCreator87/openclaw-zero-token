/**
 * Bridge module: re-exports web stream factories from zero-token/streams.
 *
 * This file provides a stable import path for `attempt.ts` and `compact.ts`,
 * isolating them from changes in the zero-token directory structure.
 *
 * Architecture:
 * - `src/zero-token/streams/web-stream-factories.ts` — source of truth
 * - `src/agents/web-stream-factories.ts` — this bridge (re-export)
 * - `attempt.ts` / `compact.ts` — import from this bridge
 */
export {
  getWebStreamFactory,
  listWebStreamApiIds,
  type WebStreamApiId,
} from "../zero-token/streams/web-stream-factories.js";
