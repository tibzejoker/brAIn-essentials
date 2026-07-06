/**
 * E2E: LLM budget system (reactive runtime).
 *
 * Since the "purely reactive runtime" refactor there is no sleep/wake:
 * a handler returns and the runner parks the node; the next subscribed
 * bus message drives it again. The budget caps chained iterations
 * within one wake and is surfaced to the LLM via the system hint.
 * Verifies:
 *   1. The LLM sees the budget info in its system hint (responds TURN 1)
 *   2. One inbound message = one wake — no runaway extra iterations
 *   3. A new message re-drives the parked node with a fresh budget
 *
 * Requires: Ollama running with the test model.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { BrainService, LLMRegistry } from "@brain/core";
import * as fs from "fs";
import * as path from "path";
import { allStoreprojectNodeDirs } from "./_helpers/storeprojects-dirs";

const TEST_MODEL = "ollama/gemma4:e4b";
const DATA_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..", "brAIn", "data");
const MEM_PATH = path.join(DATA_DIR, "memory.json");
// Generous: when the whole monorepo suite runs in parallel, several
// suites hammer the same local Ollama and a turn can take >60s.
const MAX_WAIT = 120_000;

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return false;
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models.some((m) => m.name.includes("gemma4"));
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => { setTimeout(r, ms); });
}

async function waitFor(fn: () => boolean, ms = MAX_WAIT): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await delay(1000);
  }
  return fn();
}

describe("e2e: LLM budget system", async () => {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) {
    it.skip("Ollama not available", () => {});
    return;
  }

  let brain: BrainService | null = null;
  const hadMemory = fs.existsSync(MEM_PATH);
  const memBackup = `${MEM_PATH}.budget-bak`;

  afterEach(() => { try { brain?.killAll(); } catch { /* */ } brain = null; });
  afterAll(() => {
    if (hadMemory && fs.existsSync(memBackup)) {
      fs.copyFileSync(memBackup, MEM_PATH); fs.unlinkSync(memBackup);
    } else if (fs.existsSync(MEM_PATH)) {
      fs.unlinkSync(MEM_PATH);
    }
  });

  it("runs one wake per inbound message and parks — budget hint injected", async () => {
    if (hadMemory) fs.copyFileSync(MEM_PATH, memBackup);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MEM_PATH, "{}");

    brain = new BrainService(":memory:");
    brain.bootstrap(allStoreprojectNodeDirs());
    await LLMRegistry.getInstance().initialize();

    const BUDGET = 3;

    const node = await brain.spawnNode({
      type: "brain",
      name: "budget-test",
      subscriptions: [{ topic: "budget.test" }],
      config_overrides: {
        model: TEST_MODEL,
        response_topic: "budget.response",
        max_steps: 1,
        max_iterations: BUDGET,
      },
    });

    await delay(2000);

    // Send a message to start the budget loop
    brain.bus.publish({
      from: "test", topic: "budget.test", type: "text", criticality: 3,
      payload: {
        content: "Each time you are called, use the respond tool with ONLY the text 'TURN X' where X is the iteration number from your system hint. NEVER use the stop tool — always respond, on every single turn, until you are put to sleep.",
      },
    });

    // Wait for the wake to produce a response
    const answered = await waitFor(
      () => (brain?.bus.getMessageHistory({ topic: "budget.response", last: 5 }) ?? []).length > 0,
    );
    // Give a (buggy) runaway loop time to show up before we count iterations
    await delay(8000);

    // Check what happened
    const logs = brain.getNodeLogs(node.id, 30);
    const responses = brain.bus.getMessageHistory({ topic: "budget.response", last: 10 });
    const iterations = logs.filter((l) => l.message.startsWith("Iteration "));

    console.log("  Logs:");
    for (const l of logs) console.log(`    [${l.level}] ${l.message.slice(0, 120)}`);
    console.log("  Responses:", responses.map((m) => (m.payload as { content: string }).content.slice(0, 60)));

    // One message → one wake, then the node parks. No extra iterations
    // may happen without new inbound messages.
    expect(answered, "Node should have responded to the message").toBe(true);
    expect(iterations.length).toBeLessThanOrEqual(BUDGET); // bounded by the budget, no runaway

    // Verify the LLM saw the budget hint (at least one response should mention a turn)
    const responseTexts = responses.map((m) => (m.payload as { content: string }).content);
    const anyTurnMention = responseTexts.some((t) => /turn|iteration|[123]/i.test(t));
    expect(anyTurnMention, "LLM should have responded at least once with turn info").toBe(true);
  }, MAX_WAIT + 30_000);

  it("resets budget when a new message arrives", async () => {
    if (hadMemory) fs.copyFileSync(MEM_PATH, memBackup);
    fs.writeFileSync(MEM_PATH, "{}");

    brain = new BrainService(":memory:");
    brain.bootstrap(allStoreprojectNodeDirs());
    await LLMRegistry.getInstance().initialize();

    const node = await brain.spawnNode({
      type: "brain",
      name: "reset-test",
      subscriptions: [{ topic: "reset.test" }],
      config_overrides: {
        model: TEST_MODEL,
        response_topic: "reset.response",
        max_steps: 3,
        max_iterations: 2,
      },
    });

    await delay(2000);

    // First message — starts budget of 2
    brain.bus.publish({
      from: "test", topic: "reset.test", type: "text", criticality: 3,
      payload: { content: "Reply with exactly: HELLO 1" },
    });

    // Wait for first response + forced sleep + wake
    await waitFor(() => {
      const r = brain?.bus.getMessageHistory({ topic: "reset.response", last: 5 }) ?? [];
      return r.length > 0;
    });
    await delay(5000); // let the wake fully end and the node park

    // Second message — should reset budget
    brain.bus.publish({
      from: "test", topic: "reset.test", type: "text", criticality: 3,
      payload: { content: "Reply with exactly: HELLO 2" },
    });

    // Wait for second response
    await waitFor(() => {
      const r = brain?.bus.getMessageHistory({ topic: "reset.response", last: 5 }) ?? [];
      return r.length >= 2;
    });

    const responses = brain.bus.getMessageHistory({ topic: "reset.response", last: 10 });
    const texts = responses.map((m) => (m.payload as { content: string }).content);

    console.log("  Responses:", texts.map((t) => t.slice(0, 60)));

    // Should have responses from BOTH messages (budget was reset for the second)
    const hasFirst = texts.some((t) => /hello.*1|1/i.test(t));
    const hasSecond = texts.some((t) => /hello.*2|2/i.test(t));

    expect(hasFirst, "Should have response to first message").toBe(true);
    expect(hasSecond, "Should have response to second message (budget reset)").toBe(true);
  }, MAX_WAIT + 30_000);
});
