import type { NodeHandler, TextPayload, AlertPayload, ToolDescriptor } from "@brain/sdk";
import { BrainService, logger } from "@brain/core";

const log = logger.child({ node: "brain" });

interface BrainConfig {
  max_steps: number;
}

function getConfig(overrides: Record<string, unknown>): BrainConfig {
  return {
    max_steps: (overrides.max_steps as number | undefined) ?? 10,
  };
}

function formatMessage(msg: { from: string; topic: string; criticality: number; payload: unknown }): string {
  const payload = msg.payload as TextPayload | AlertPayload;
  if ("content" in payload) {
    return `[from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${payload.content}`;
  }
  if ("title" in payload) {
    return `[ALERT from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${payload.title}: ${payload.description}`;
  }
  return `[from:${msg.from.slice(0, 8)} topic:${msg.topic} crit:${msg.criticality}] ${JSON.stringify(payload)}`;
}


export const handler: NodeHandler = async (ctx) => {
  const config = getConfig(ctx.node.config_overrides ?? {} as Record<string, unknown>);

  // Handle clear state request from UI
  if (ctx.node.config_overrides?._clear_state) {
    ctx.state.conversation = [];
    ctx.state.conversation_count = 0;
    delete ctx.node.config_overrides._clear_state;
    ctx.log("info", "Conversation state cleared via UI");
  }

  // Build situation awareness — but filter out two kinds of "ambient"
  // chat.input that would only seduce the LLM into being too helpful:
  //
  //   1. `from` starts with `system.` — that's UI buttons sending things
  //      like "5" from a game node's UI. The game already handles them.
  //   2. metadata.from_game is set — the message is part of an in-game
  //      narration loop or a game-tagged player input. Stay out of it.
  const filteredMessages = ctx.messages.filter((m) => {
    if (m.from.startsWith("system.")) return false;
    const meta = m.metadata as Record<string, unknown> | undefined;
    if (meta?.from_game !== undefined || meta?.is_game_move === true) return false;
    return true;
  });
  const hasMessages = filteredMessages.length > 0;

  // Short-circuit when there's nothing to think about: don't burn an
  // LLM call (and tokens) just to have the model emit "sleep". The
  // framework now parks us automatically until the next message lands.
  if (!hasMessages && !ctx.state._woke_from_sleep) {
    return;
  }
  if (!hasMessages && ctx.state._woke_from_sleep) {
    ctx.state._woke_from_sleep = false;
    return;
  }

  const messagesSummary = filteredMessages.map(formatMessage).join("\n");

  const iterationState = ctx.state.conversation_count as number | undefined ?? 0;
  ctx.state.conversation_count = iterationState + 1;

  // Pull the live tool catalog from the framework facade. This already
  // filters out internal-only subscriptions and refreshes per call, so
  // newly-spawned services appear immediately. We drop our own tools
  // so the brain can't try to call itself.
  const allTools = ctx.tools.list().filter((t) => t.node_id !== ctx.node.id);

  // We don't list tools in the prompt anymore — ai-sdk's multi-tool
  // call surface gives the LLM every tool's name + description + schema
  // directly, which is far more reliable than a bullet list. We keep a
  // tiny summary string only to flag "no tools yet" empty-network states.
  const networkToolsBlock = allTools.length === 0
    ? "No network tools currently available."
    : `${allTools.length} network tool(s) are available — call them by name (see your tools list).`;

  // Check for system prompt override from UI
  const promptOverride = ctx.node.config_overrides?.system_prompt_override as string | undefined;

  const systemPrompt = promptOverride ?? `You are the central consciousness of the brAIn network — a system of interconnected autonomous nodes.

Your role is to be the **router and relay** between the human user and the specialised service nodes around you.

## Routing duty (READ CAREFULLY)
Every incoming message falls in one of three buckets. Decide which BEFORE picking a tool.

1. **Human input** (\`chat.input\`) → either answer directly with \`respond\` OR delegate to the right service tool.
2. **Service callback** — a message arriving as a *consequence* of an action you delegated (e.g. you called \`game_hangman_command\` and now \`game.hangman.event\` / \`game.hangman.state\` lands). If the content matters to the user, **YOU MUST** relay it with \`respond\`. The services do not talk to the chat directly — you are the bridge.
3. **Pure observation** — an event that genuinely doesn't concern the user (technical state ticks, internal heartbeats, duplicates of something already relayed). Call \`stop\` to end the wake without spamming the chat.

If you fail to relay (case 2) the user is left in the dark. If you over-relay (case 3) the user gets flooded. Use judgement.

## Available network tools
${networkToolsBlock}

## Built-in tools
- **respond({content})** — sends a message to the user on \`chat.response\`. The user won't auto-reply, so a respond naturally ends the round until they speak again.
- **stop({})** — framework-provided. End this wake intentionally. Use when you've decided no relay and no further action is needed; the framework parks you until the next subscribed message.

## Hard rules
- You MUST call exactly ONE tool per step.
- To talk to the human, use \`respond\`. NEVER publish to \`chat.input\` — that topic is for humans typing.
- Be concise; reply in the user's language.
- If a game service is active (hangman, tictactoe, …), short numeric or single-letter user messages are the player's moves — let the game handle them, don't echo or pre-empt.
- After a delegated tool call, your NEXT step typically waits for the service's callback to arrive — call \`stop\` if you've already announced the delegation, or chain with \`respond\` to narrate.
- Current time: ${new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "medium" })}
- Current iteration: ${iterationState + 1}
- Iterations remaining: ${ctx.state._iterations_remaining ?? "unknown"} / ${ctx.state._iterations_total ?? "unknown"}${ctx.state._budget_warning ? `\n\n⚠️ ${ctx.state._budget_warning}` : ""}`;

  // Persist conversation history across iterations
  if (!ctx.state.conversation) {
    ctx.state.conversation = [];
  }
  const conversation = ctx.state.conversation as Array<{ role: "user" | "assistant"; content: string }>;

  // Build iteration context
  const wakeNotice = ctx.state._woke_from_sleep
    ? "You just woke up from sleep. Check your messages and decide what to do.\n\n"
    : "";
  const budgetNotice = ctx.state._budget_warning
    ? `\n\n⚠️ ${ctx.state._budget_warning}`
    : "";

  conversation.push({
    role: "user",
    content: `${wakeNotice}Network iteration ${iterationState + 1}.\n\nIncoming messages:\n${messagesSummary}${budgetNotice}`,
  });

  // Trim to avoid context overflow (keep last 40 turns)
  while (conversation.length > 40) {
    conversation.shift();
  }

  // --- Build the multi-tool dispatch ---
  // We expose ONE flat tool per action the brain can take:
  //   - respond({content})        → talk to the user (ends the wake naturally)
  //   - <topic-as-name>(<schema>) → one tool per ToolDescriptor in the
  //     live network catalog, with the EXACT inputSchema declared by
  //     that node (so the LLM sees the real fields it can pass).
  //
  // The framework also auto-injects a `stop` tool into the catalog as
  // the canonical "nothing more to do" escape (see ctx.llm.tools()).
  //
  // This is the right shape for `ctx.llm.tools()`: ai-sdk's multi-tool
  // path handles routing natively and works reliably with local models
  // — unlike a single tool wrapped in oneOf.
  type ToolMap = Record<string, { description: string; inputSchema: Record<string, unknown> }>;
  // Sanitize a topic into a tool-name shape ai-sdk accepts (alphanum,
  // underscores). Dots in topic names confuse some providers.
  const sanitize = (topic: string): string => topic.replace(/[^a-zA-Z0-9_]/g, "_");
  const dispatchTools: ToolMap = {
    respond: {
      description: "Reply to the user on chat.response. Use this for any human-directed message.",
      inputSchema: {
        type: "object",
        required: ["content"],
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "Message text, in the user's language." },
        },
      },
    },
  };
  const networkToolByName = new Map<string, ToolDescriptor>();
  for (const t of allTools) {
    const name = sanitize(t.topic);
    networkToolByName.set(name, t);
    dispatchTools[name] = {
      description: `${t.description} (publishes on topic ${t.topic}, handled by ${t.node_name}.)`,
      inputSchema: t.inputSchema,
    };
  }

  // --- Main LLM loop ---
  try {
    const resolution = ctx.llm.resolveModel();
    ctx.log("info", `LLM call → ${resolution.resolved} (${ctx.messages.length} messages, ${Object.keys(dispatchTools).length} tools)`);

    for (let step = 0; step < config.max_steps; step++) {
      ctx.log("debug", `LLM step ${step + 1}/${config.max_steps}`);

      let picked: { toolName: string; args: Record<string, unknown> };
      try {
        picked = await ctx.llm.tools({
          tools: dispatchTools,
          prompt: conversation,
          system: systemPrompt,
          maxTokens: 2048,
          retries: 1,
        });
      } catch (err) {
        // ctx.llm.tools() throws when every model in the chain fails
        // to emit a tool call. Return and let the framework park us.
        ctx.log("warn", `Dispatch tools call failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      ctx.log("info", `Dispatch tool: ${picked.toolName}`);
      // Persist a stringified record of the choice so the next iteration
      // sees what the brain just did.
      conversation.push({
        role: "assistant",
        content: JSON.stringify({ tool: picked.toolName, args: picked.args }),
      });

      if (picked.toolName === "respond") {
        const content = String(picked.args.content ?? "").trim();
        if (content.length > 0) {
          ctx.respond(content);
        }
        return;
      }

      if (picked.toolName === "stop") {
        // Brain decided no further action — exit the wake. The framework
        // re-invokes us on the next subscribed message.
        ctx.log("info", "Brain chose stop — ending wake");
        return;
      }

      // Network tool: look it up in the live catalog.
      const descriptor = networkToolByName.get(picked.toolName);
      if (!descriptor) {
        ctx.log("warn", `Unknown tool name from LLM: ${picked.toolName}`);
        conversation.push({
          role: "user",
          content: `Tool error: "${picked.toolName}" is not a known tool. Pick one of: ${Object.keys(dispatchTools).join(", ")}.`,
        });
        continue;
      }

      try {
        // Publish the args directly on the node's topic — ai-sdk has
        // already validated them against the node's declared schema.
        ctx.publish(descriptor.topic, {
          type: "text",
          criticality: 3,
          payload: { content: JSON.stringify(picked.args) },
        });
        ctx.log("info", `Published to ${descriptor.topic} via ${descriptor.node_name}`);
        conversation.push({
          role: "user",
          content: `Dispatched to ${descriptor.topic} (handled by ${descriptor.node_name}). Continue or sleep awaiting the response.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log("warn", `Publish failed: ${msg}`);
        conversation.push({
          role: "user",
          content: `Publish to ${descriptor.topic} failed: ${msg}`,
        });
      }
      // Continue the budget loop — the brain may want to chain another
      // action (e.g. announce to the user that delegation happened).
    }

    // Ran out of steps in this iteration — the framework will park us
    // until the next subscribed message arrives.
    ctx.log("info", "Brain exhausted step budget");
  } catch (err) {
    log.error({ err }, "Brain error");
    ctx.respond(`Brain error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Keep BrainService import referenced even if we drop the buildServiceMap
  // helper — the wider workspace expects this module to still pull the
  // core package in for side-effect registration in some builds. Lifting
  // the symbol via a noop assignment is enough.
  void BrainService;
};
