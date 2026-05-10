export const NODE_TEMPLATE_DOCS = `
## How to create a brAIn node

A node is a self-contained package in \`nodes/_dynamic/<slug>/\` with FIVE files.
The framework watches this directory; as soon as your build produces a valid
\`dist/\` AND your tests pass, it auto-registers the type. You do NOT register
anything yourself, and you do NOT spawn instances. Just write, build, react to
validation feedback.

### Mandatory file layout

\`\`\`
<slug>/
  config.json
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    handler.ts
  tests/
    handler.test.ts   (MUST exist — at least one passing test)
\`\`\`

### 1. config.json
\`\`\`json
{
  "name": "my-unique-name",
  "description": "One sentence describing what this node does.",
  "tags": ["relevant", "tags"],
  "default_authority": 0,
  "default_priority": 1,
  "default_subscriptions": [{ "topic": "some.input.topic" }],
  "default_publishes": ["some.output.topic"],
  "supports_transport": ["process"]
}
\`\`\`

### 2. package.json
\`\`\`json
{
  "name": "@brain/node-my-unique-name",
  "version": "0.1.0",
  "private": true,
  "main": "dist/handler.js",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@brain/sdk": "workspace:*" },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^3.2.4",
    "@types/node": "^20.11.0"
  }
}
\`\`\`

Add \`"@brain/core": "workspace:*"\` to dependencies ONLY if you actually use core
helpers (LLMRegistry, logger, etc.). Otherwise keep it out — the SDK types are enough.

### 3. tsconfig.json (COPY EXACTLY — wrong rootDir means dist/src/handler.js instead of dist/handler.js, framework rejects)
\`\`\`json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"]
}
\`\`\`

CRITICAL: \`rootDir\` MUST be \`"./src"\` (not \`"."\`) and \`include\` MUST be \`["src"]\` (NOT \`["src", "tests"]\`). Otherwise tsc emits \`dist/src/handler.js\` and the framework can't load \`dist/handler.js\`. Tests are run by vitest separately — they don't need to be in tsconfig.

### 4. vitest.config.ts
\`\`\`typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 10000 },
});
\`\`\`

### 5. src/handler.ts
\`\`\`typescript
import type { NodeHandler, TextPayload } from "@brain/sdk";

export const handler: NodeHandler = async (ctx) => {
  if (ctx.messages.length === 0) {
    ctx.sleep([{ type: "any" }]);
    return;
  }

  for (const msg of ctx.messages) {
    const payload = msg.payload as TextPayload;
    const input = payload.content;

    // ... do the work ...

    ctx.respond(\`processed: \${input}\`);
  }
};
\`\`\`

### 6. tests/handler.test.ts (MANDATORY, at least one test)
\`\`\`typescript
import { describe, it, expect, vi } from "vitest";
import type { NodeContext, Message } from "@brain/sdk";
import { handler } from "../src/handler";

function makeCtx(messages: Message[] = []): NodeContext {
  const published: Array<{ topic: string; content: string }> = [];
  return {
    messages,
    readMessages: () => messages,
    respond: vi.fn((content: string) => { published.push({ topic: "default", content }); }),
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sleep: vi.fn(),
    callLLM: vi.fn(),
    callTool: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listFiles: vi.fn(),
    state: {},
    log: vi.fn(),
    node: { id: "test", type: "test", name: "test", description: "", tags: [], authority_level: 0, state: "active", priority: 0, subscriptions: [], transport: "process", position: { x: 0, y: 0 }, created_at: Date.now() },
    iteration: 0,
    wasPreempted: false,
    _published: published,
  } as unknown as NodeContext;
}

describe("my-node handler", () => {
  it("sleeps when there are no messages", async () => {
    const ctx = makeCtx();
    await handler(ctx);
    expect(ctx.sleep).toHaveBeenCalled();
  });

  it("responds when it receives input", async () => {
    const msg: Message = {
      id: "m1", from: "upstream", topic: "some.input.topic",
      type: "text", criticality: 0, payload: { content: "hello" }, timestamp: Date.now(),
    };
    const ctx = makeCtx([msg]);
    await handler(ctx);
    expect(ctx.respond).toHaveBeenCalled();
  });
});
\`\`\`

## Rules the framework enforces (not you — the build/test gate does)

- \`handler\` MUST be exported as \`export const handler: NodeHandler\` (or \`default\`)
- \`tests/\` MUST contain at least one \`*.test.ts\` and every test MUST pass
- \`dist/handler.js\` MUST exist and be up-to-date (run \`npx tsc\` after any src change)
- If any of the above fails, the framework publishes \`types.validation_failed\` on the bus
  with \`{slug, phase: "install"|"compile"|"missing_tests"|"tests"|"config", errors}\`.
- You — the developer node — listen for that topic and correct the workspace.

## Topic conventions (CRITICAL — read before picking publish/subscribe topics)

Topics are NATS subjects. Two wildcard rules every node author must keep in mind:

- \`*\` matches **exactly one** segment. \`chat.response.*\` matches \`chat.response.brain\`
  but does NOT match \`chat.response\` (no trailing segment).
- \`>\` matches **one or more** segments at the tail. \`memory.>\` matches
  \`memory.write\` and \`memory.vector.upsert\`.

If you publish a "bare" topic like \`chat.response\` while a subscriber listens on
\`chat.response.*\`, your message goes into the void. **Always publish on the
fully-qualified topic the subscribers expect.**

### Well-known topics in the brAIn network

When asked to integrate with the existing network, use these exact topics:

| If you want to… | Subscribe to | Publish on |
|---|---|---|
| React to a human chat message | \`chat.input\` | \`chat.response.<your-node-name>\` (NOT \`chat.response\`) |
| Speak text aloud through the OS TTS node | — | \`tts.speak\` (text in payload, optional \`voice\`/\`rate\` in metadata) |
| Use voice transcripts | \`voice.transcript\` | — |
| Use gaze-resolved targets | \`gaze.target.resolved\` | — |
| Use the intent correlator's output | \`intent.detected\` | — |
| Drive a phone running brAIn-mobile | — | \`mobile.<deviceId>.tts.speak\` / \`mobile.<deviceId>.flash\` |
| Read phone sensors | \`mobile.<deviceId>.sensor.accel\` etc. | — |

Pattern: when you produce something for a known consumer (chat, brain, …),
**append a unique segment** identifying yourself (\`chat.response.mockery-bot\`,
\`chat.response.weather\`, …). When you consume from a known producer, subscribe
to the exact published topic.

If the request mentions "chat" / "réponds dans le chat" / "answer the user", the
correct publish topic is \`chat.response.<your-node-name>\`. The chat node's
subscription is \`chat.response.*\` (verify in \`brAIn-ui/nodes/chat/config.json\`)
— a bare \`chat.response\` will NOT reach the UI.

## Other conventions

- NO \`console.log\` (lint-banned). If logging is truly needed, use \`ctx.log(...)\`
- Type everything; avoid \`any\`
- If the handler does not use \`await\`, return \`Promise.resolve()\` and drop \`async\`
- A node must NOT subscribe to its own output topics (framework blocks self-loops anyway)
- Keep the handler under ~300 lines
`;
