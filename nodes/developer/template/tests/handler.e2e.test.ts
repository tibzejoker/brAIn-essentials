/**
 * Opt-in end-to-end test — spawned by `pnpm test:e2e`, skipped by
 * `pnpm test` (vitest.config excludes `*.e2e.test.ts` from the default
 * include pattern).
 *
 * Unlike the unit test in `handler.test.ts` (which calls `handler(ctx)`
 * with a hand-crafted mock ctx), this one boots a real BrainService +
 * bus, registers the node type, spawns one instance, publishes a real
 * message on the bus, and asserts the response/state. Slower (~1-2s
 * setup) but actually exercises the runner + bus wiring + auto-park
 * loop the way production does.
 *
 * Run locally:    pnpm test:e2e
 * Run from root:  pnpm -r run test:e2e
 *
 * Delete this file if your node really doesn't need an e2e — but most
 * nodes benefit, especially anything that listens to multiple topics or
 * publishes downstream.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { BrainService, BusService } from "@brain/core";

describe("TEMPLATE_NAME e2e", () => {
  let brain: BrainService;

  beforeAll(async () => {
    // In-memory bus (no NATS) + in-memory SQLite — fast, hermetic.
    brain = new BrainService(":memory:", new BusService());
    // bootstrap() registers every node type in the dir. The node's own
    // dir is the parent of __dirname here (tests/ → node root).
    brain.bootstrap([resolve(__dirname, "..", "..")]);
  });

  afterAll(() => {
    brain.killAll();
  });

  it("spawns + handles one message end-to-end", async () => {
    const inst = await brain.spawnNode({ type: "TEMPLATE_NAME", name: "e2e" });
    expect(inst.id).toBeTruthy();

    // Publish a message matching the node's declared inputSchema.
    brain.bus.publish({
      from: "e2e-test",
      topic: "TEMPLATE_PUBLIC_TOPIC",
      type: "text",
      criticality: 3,
      payload: { content: JSON.stringify({ action: "ping" }) },
    });

    // Give the runner a tick to consume the mailbox + publish back.
    await new Promise((r) => setTimeout(r, 200));

    // Assert what the node SHOULD have done — replace these with real
    // checks once your handler does real work. Examples:
    //
    //   const replies = brain.bus.getMessageHistory({ topic: "chat.response", last: 10 });
    //   expect(replies.some((m) => (m.payload as { content: string }).content.includes("…"))).toBe(true);
    //
    //   const events = brain.bus.getMessageHistory({ topic: "TEMPLATE_PUBLIC_TOPIC.event", last: 10 });
    //   expect(events.length).toBeGreaterThan(0);
    expect(true).toBe(true);
  });
});
