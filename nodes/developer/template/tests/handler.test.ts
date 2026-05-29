import { describe, it, expect, vi } from "vitest";
import type { NodeContext, Message } from "@brain/sdk";
import { handler } from "../src/handler";

function makeCtx(messages: Message[] = []): NodeContext {
  const published: Array<{ topic: string; content: string }> = [];
  return {
    messages,
    readMessages: () => messages,
    respond: vi.fn((content: string) => { published.push({ topic: "chat.response", content }); }),
    publish: vi.fn((topic: string, msg: { payload: { content: string } }) => {
      published.push({ topic, content: msg.payload.content });
    }),
    emit_port: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    // Preferred LLM surface — model resolution / failover handled for you.
    llm: { text: vi.fn(), tool: vi.fn(), tools: vi.fn(), agent: vi.fn() },
    tools: { list: vi.fn(() => []), listForNode: vi.fn(() => []) },
    state: {},
    dataDir: "/tmp/template-test",
    log: vi.fn(),
    node: {
      id: "test", type: "test", name: "test", description: "",
      tags: [], authority_level: 0, state: "active", priority: 0,
      subscriptions: [], transport: "process", position: { x: 0, y: 0 },
      created_at: Date.now(),
    },
    iteration: 0,
    wasPreempted: false,
    signal: new AbortController().signal,
    _published: published,
  } as unknown as NodeContext;
}

describe("TEMPLATE_NAME handler", () => {
  it("is a no-op when there are no messages", async () => {
    const ctx = makeCtx();
    await expect(handler(ctx)).resolves.toBeUndefined();
    expect(ctx.respond).not.toHaveBeenCalled();
    expect(ctx.publish).not.toHaveBeenCalled();
  });

  it("responds + publishes when it receives input", async () => {
    const msg: Message = {
      id: "m1", from: "upstream", topic: "TEMPLATE_PUBLIC_TOPIC",
      type: "text", criticality: 0,
      payload: { content: JSON.stringify({ action: "ping" }) },
      timestamp: Date.now(),
    };
    const ctx = makeCtx([msg]);
    await handler(ctx);
    expect(ctx.respond).toHaveBeenCalled();
    expect(ctx.publish).toHaveBeenCalled();
    expect(ctx.state._count).toBe(1);
  });
});
