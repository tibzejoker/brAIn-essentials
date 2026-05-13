import type { NodeHandler, NodeInfo, NodeOnSpawn, NodeTeardown } from "@brain/sdk";
import { BrainService } from "@brain/core";

/**
 * Clock — the canonical 1Hz heartbeat of the network.
 *
 * Self-driven: a `setInterval` started at spawn publishes `time.tick`
 * every second. The handler itself is a no-op; clock doesn't react
 * to bus traffic, it generates it. This pattern (interval in onSpawn,
 * teardown clears it) is the right shape for any "tick source" node
 * — it sidesteps the framework's reactive-only wake model.
 */

const intervals = new Map<string, NodeJS.Timeout>();

export const onSpawn: NodeOnSpawn = (info: NodeInfo) => {
  const handle = setInterval(() => {
    BrainService.current?.bus.publish({
      from: info.id,
      topic: "time.tick",
      type: "text",
      criticality: 0,
      payload: { content: new Date().toISOString() },
    });
  }, 1000);
  intervals.set(info.id, handle);
};

export const teardown: NodeTeardown = (info: NodeInfo) => {
  const handle = intervals.get(info.id);
  if (handle) {
    clearInterval(handle);
    intervals.delete(info.id);
  }
};

// Clock has no real bus inputs — keep a stub handler so the framework's
// loader is happy. Any stray message addressed to us is ignored.
export const handler: NodeHandler = () => Promise.resolve();
