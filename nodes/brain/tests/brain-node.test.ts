import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BrainService, LLMRegistry } from "@brain/core";
import type { Message } from "@brain/sdk";
import { allStoreprojectNodeDirs } from "./_helpers/storeprojects-dirs";

describe("Brain node: central consciousness", () => {
  let brain: BrainService;

  beforeAll(async () => {
    LLMRegistry.resetInstance();
    brain = new BrainService(":memory:");
    brain.bootstrap(allStoreprojectNodeDirs());
    await LLMRegistry.getInstance().initialize();
  }, 60000);

  afterAll(() => {
    brain.killAll();
  });

  it("spawns, receives messages, and responds or sleeps", async () => {
    if (!LLMRegistry.getInstance().isAvailable("ollama")) {
      return;
    }

    const collected: Message[] = [];
    brain.bus.on("message:published", (msg: Message) => {
      if (msg.topic === "brain.output") {
        collected.push(msg);
      }
    });

    // Spawn a clock first so the brain has something to see
    await brain.spawnNode({ type: "clock", name: "bg-clock" });

    // Spawn the brain
    const brainNode = await brain.spawnNode({
      type: "brain",
      name: "consciousness",
      subscriptions: [
        { topic: "brain.*" },
        { topic: "alerts.*" },
      ],
      config_overrides: {
        model: "ollama/gemma4:e4b",
        response_topic: "brain.output",
        max_steps: 5,
      },
    });

    expect(brainNode.state).toBe("active");
    expect(brainNode.authority_level).toBe(2); // root

    // Wait for the brain to run at least one iteration
    await new Promise((r) => { setTimeout(r, 3000); });

    // Send it a message
    brain.bus.publish({
      from: "test",
      topic: "brain.request",
      type: "text",
      criticality: 5,
      payload: { content: "What nodes are currently running? Just list their names." },
    });

    // Wait for response
    const maxWait = 60000;
    const start = Date.now();
    while (collected.length === 0 && Date.now() - start < maxWait) {
      await new Promise((r) => { setTimeout(r, 1000); });
    }

    // The brain should have responded or gone to sleep (both are valid)
    const brainState = brain.instanceRegistry.get(brainNode.id);
    expect(brainState).toBeDefined();

    // It either published a response or is sleeping (both valid for a small model)
    const responded = collected.length > 0;
    const sleeping = brainState?.state === "sleeping";

    expect(responded || sleeping).toBe(true);

    if (responded) {
      const payload = collected[0].payload as Record<string, unknown>;
      expect(typeof payload.content === "string" || typeof payload.title === "string").toBe(true);
    }

    brain.killAll();
  }, 90000);
});
