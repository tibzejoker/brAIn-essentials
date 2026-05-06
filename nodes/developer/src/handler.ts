import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { NodeContext, NodeHandler, TextPayload, Message, NodeInfo } from "@brain/sdk";
import { BrainService, CLIRegistry } from "@brain/core";
import { NODE_TEMPLATE_DOCS } from "./template";
import { v4 as uuid } from "uuid";

interface DevConfig {
  cli: string;
  timeout_ms: number;
  max_attempts: number;
}

interface WorkspaceMeta {
  slug: string;
  path: string;
  caller?: string;
  attempts: number;
  request: string;
  cli: string;
  mode: "create" | "improve";
}

interface WorkspacesState {
  [slug: string]: WorkspaceMeta;
}

interface ValidationPayload {
  slug?: string;
  type_name?: string;
  phase?: string;
  errors?: string;
  path?: string;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".dart_tool", ".pub-cache", "build",
  ".git", ".idea", ".vscode", "ios", "android", "windows", "macos", "linux",
]);

function getConfig(overrides: Record<string, unknown>): DevConfig {
  return {
    cli: (overrides.cli as string | undefined) ?? "claude",
    timeout_ms: (overrides.timeout_ms as number | undefined) ?? 300_000,
    max_attempts: (overrides.max_attempts as number | undefined) ?? 3,
  };
}

/**
 * Find brAIn's monorepo root — specifically brAIn (the framework repo),
 * not whichever sister repo this handler happens to be installed under.
 *
 * We anchor on `packages/sdk/package.json` containing `@brain/sdk`: a
 * marker only the framework root has. Sister repos have their own
 * `pnpm-workspace.yaml`, so just looking for that lands in the wrong
 * place when this node ships from `brAIn-essentials`.
 *
 * Walks up from `__dirname` first; if that fails (loose install layout),
 * falls back to `process.cwd()` and walks again. Last resort: `cwd`.
 */
export function resolveMonorepoRoot(start: string = __dirname): string {
  for (const origin of [start, process.cwd()]) {
    let dir = origin;
    for (let i = 0; i < 12; i++) {
      const sdkPkg = path.join(dir, "packages", "sdk", "package.json");
      if (fs.existsSync(sdkPkg)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(sdkPkg, "utf-8")) as { name?: string };
          if (pkg.name === "@brain/sdk") return dir;
        } catch { /* keep walking */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function getWorkspaces(state: Record<string, unknown>): WorkspacesState {
  if (!state.workspaces) state.workspaces = {};
  return state.workspaces as WorkspacesState;
}

function parseValidationPayload(msg: Message): ValidationPayload {
  const content = (msg.payload as TextPayload).content;
  try {
    return JSON.parse(content) as ValidationPayload;
  } catch {
    return {};
  }
}

export function parseJsonContent(msg: Message): Record<string, unknown> {
  const content = (msg.payload as TextPayload).content ?? "";
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch { /* not JSON */ }
  // Fall back to metadata if the message used the typed envelope.
  if (msg.metadata && typeof msg.metadata === "object") {
    return msg.metadata as Record<string, unknown>;
  }
  return { content };
}

export function pickCli(overrides: Record<string, unknown>, msgMeta: Record<string, unknown> | undefined): string {
  const fromMsg = msgMeta && typeof msgMeta.cli === "string" ? (msgMeta.cli as string) : undefined;
  if (fromMsg) return fromMsg;
  return (overrides.cli as string | undefined) ?? "claude";
}

function runCli(
  cli: string,
  prompt: string,
  cwd: string,
  timeoutMs: number,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const tmpFile = path.join(cwd, ".prompt.tmp");
    fs.writeFileSync(tmpFile, prompt, "utf-8");

    const proc = spawn(
      "sh",
      ["-c", `cat "${tmpFile}" | ${cli} -p - --max-turns 40 --dangerously-skip-permissions`],
      // signal: SIGTERM to the shell + the CLI agent on preemption,
      // matching the runner's per-iteration AbortController.
      { cwd, timeout: timeoutMs, signal },
    );

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n").filter(Boolean)) onLine(line);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLine(`[stderr] ${line}`);
    });
    proc.on("close", (code) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve({ stdout, exitCode: code ?? 1 });
    });
    proc.on("error", (err) => {
      onLine(`[error] ${err.message}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve({ stdout, exitCode: 1 });
    });
  });
}

function buildInitialPrompt(workspacePath: string, request: string): string {
  return `You are authoring a new brAIn node in: ${workspacePath}

${NODE_TEMPLATE_DOCS}

## Requested node
${request}

## Instructions
1. Create ALL required files (config.json, package.json, tsconfig.json, vitest.config.ts, src/handler.ts, tests/handler.test.ts) in ${workspacePath}.
2. Run: cd ${workspacePath} && pnpm install --no-frozen-lockfile && npx tsc && npx vitest run
3. Fix any compile or test errors, rebuild, retest until all pass.
4. Stop when \`dist/handler.js\` exists and \`npx vitest run\` exits 0.

Do NOT explain; just author and build. Do not attempt to register or spawn — the framework does that automatically once your build and tests pass.`;
}

function buildRetryPrompt(workspacePath: string, request: string, phase: string, errors: string): string {
  return `You previously attempted to create a brAIn node in ${workspacePath}. The framework's automatic validation rejected it.

## Original request
${request}

## Validation phase that failed
${phase}

## Errors reported by the framework
\`\`\`
${errors.slice(0, 6000)}
\`\`\`

## Your task
Fix the workspace in ${workspacePath} so validation passes. Do not create a new workspace.
Re-read the existing files, address the errors, rebuild (\`npx tsc\`), rerun tests (\`npx vitest run\`).
Remember: tests are MANDATORY, at least one test must pass, no \`console.log\`, no \`any\`.

${NODE_TEMPLATE_DOCS}`;
}

function buildImprovePrompt(workspacePath: string, request: string): string {
  return `You are IMPROVING an existing brAIn node already at: ${workspacePath}

## Improvement requested
${request}

## Instructions
1. Read EVERY file already in ${workspacePath} before changing anything — config.json, package.json, src/handler.ts, tests/handler.test.ts.
2. Make the smallest set of edits that satisfies the improvement. Don't rewrite from scratch.
3. Update tests to cover the new behaviour.
4. Run: cd ${workspacePath} && npx tsc && npx vitest run — until both pass.

Do NOT change the node's name in config.json (would break re-registration as the same type).
Do NOT explain; just edit, build, test.

${NODE_TEMPLATE_DOCS}`;
}

/** Per-job line buffer — flushed on a 1s timer to dev.progress so the
 *  UI sees movement without each line clogging /messages history. */
class ProgressBuffer {
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: NodeContext,
    private readonly slug: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flush(), 1000);
  }

  push(line: string): void {
    this.buf.push(line.slice(0, 400));
    if (this.buf.length > 200) this.buf.splice(0, this.buf.length - 200);
  }

  flush(): void {
    if (this.buf.length === 0) return;
    const lines = this.buf.splice(0);
    this.ctx.publish("dev.progress", {
      type: "text",
      criticality: 0,
      payload: { content: lines.join("\n") },
      metadata: { slug: this.slug, lines, ts: new Date().toISOString() },
    });
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush();
  }
}

async function runWorkspaceJob(
  ctx: NodeContext,
  ws: WorkspaceMeta,
  prompt: string,
  config: DevConfig,
): Promise<void> {
  ws.attempts += 1;
  ctx.log("info", `[${ws.slug}] attempt ${ws.attempts}/${config.max_attempts} (cli=${ws.cli}, mode=${ws.mode})`);
  const progress = new ProgressBuffer(ctx, ws.slug);
  progress.start();
  ctx.publish("dev.progress", {
    type: "text",
    criticality: 0,
    payload: { content: `start attempt ${ws.attempts}` },
    metadata: { slug: ws.slug, lines: [`▶ start attempt ${ws.attempts} via ${ws.cli}`], ts: new Date().toISOString() },
  });
  try {
    const result = await runCli(ws.cli, prompt, path.dirname(ws.path), config.timeout_ms, (line) => {
      ctx.log("debug", `[${ws.slug}] ${line.slice(0, 200)}`);
      progress.push(line);
    }, ctx.signal);
    ctx.log("info", `[${ws.slug}] CLI exit ${result.exitCode}`);
    progress.push(`▶ CLI exit ${result.exitCode}`);
  } finally {
    progress.stop();
  }
}

async function handleNewRequest(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  config: DevConfig,
  cliRegistry: CLIRegistry,
  monorepoRoot: string,
): Promise<void> {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;
  const cli = pickCli(ctx.node.config_overrides ?? {}, meta);
  const payload = msg.payload as TextPayload;
  const request = payload.content;
  if (!request) return;

  if (!cliRegistry.isAvailable(cli)) {
    ctx.log("error", `CLI ${cli} not available`);
    ctx.respond(JSON.stringify({
      error: `CLI unavailable: ${cli}`,
      available: cliRegistry.getAvailableCLIs(),
    }));
    return;
  }

  const slug = `dev-${uuid().slice(0, 8)}`;
  const dynamicDir = path.join(monorepoRoot, "nodes", "_dynamic");
  if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true });
  const workspacePath = path.join(dynamicDir, slug);
  fs.mkdirSync(workspacePath, { recursive: true });

  const ws: WorkspaceMeta = {
    slug, path: workspacePath,
    caller: msg.from, attempts: 0, request,
    cli, mode: "create",
  };
  workspaces[slug] = ws;
  ctx.log("info", `Creating workspace ${slug}`);
  await runWorkspaceJob(ctx, ws, buildInitialPrompt(workspacePath, request), config);
}

async function handleImproveRequest(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  config: DevConfig,
  cliRegistry: CLIRegistry,
  monorepoRoot: string,
): Promise<void> {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const request = typeof body.request === "string"
    ? body.request
    : (typeof body.content === "string" ? body.content : "");
  if (!slug || !request) {
    ctx.respond(JSON.stringify({ error: "dev.improve requires {slug, request}" }));
    return;
  }
  const workspacePath = path.join(monorepoRoot, "nodes", "_dynamic", slug);
  if (!fs.existsSync(path.join(workspacePath, "config.json"))) {
    ctx.respond(JSON.stringify({ error: `unknown workspace: ${slug}` }));
    return;
  }
  const cli = pickCli(ctx.node.config_overrides ?? {}, body);
  if (!cliRegistry.isAvailable(cli)) {
    ctx.respond(JSON.stringify({
      error: `CLI unavailable: ${cli}`,
      available: cliRegistry.getAvailableCLIs(),
    }));
    return;
  }

  const ws: WorkspaceMeta = {
    slug, path: workspacePath,
    caller: msg.from, attempts: 0, request,
    cli, mode: "improve",
  };
  workspaces[slug] = ws;
  ctx.log("info", `Improving workspace ${slug}`);
  await runWorkspaceJob(ctx, ws, buildImprovePrompt(workspacePath, request), config);
}

async function handleValidationFeedback(
  ctx: NodeContext,
  msg: Message,
  workspaces: WorkspacesState,
  config: DevConfig,
): Promise<void> {
  const data = parseValidationPayload(msg);
  if (!data.slug || !(data.slug in workspaces)) return;
  const ws = workspaces[data.slug];

  if (msg.topic === "types.registered" || msg.topic === "types.updated") {
    ctx.log("info", `[${ws.slug}] registered as '${data.type_name ?? "?"}'`);

    // Auto-spawn one live instance — only on first registration. On
    // updates the framework hot-swaps the existing instances by
    // type-name, no extra spawn needed.
    let instance: NodeInfo | null = null;
    if (msg.topic === "types.registered" && data.type_name) {
      try {
        instance = await ctx.spawn({
          type: data.type_name,
          name: data.type_name,
        });
        ctx.publish("dev.spawned", {
          type: "text",
          criticality: 1,
          payload: { content: JSON.stringify({ slug: ws.slug, type_name: data.type_name, instance_id: instance.id }) },
          metadata: { slug: ws.slug, type_name: data.type_name, instance_id: instance.id, mode: ws.mode },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log("warn", `[${ws.slug}] auto-spawn failed: ${message}`);
        ctx.publish("dev.spawned", {
          type: "text",
          criticality: 2,
          payload: { content: JSON.stringify({ slug: ws.slug, type_name: data.type_name, error: message }) },
          metadata: { slug: ws.slug, type_name: data.type_name, error: message, mode: ws.mode },
        });
      }
    }

    ctx.respond(JSON.stringify({
      status: "success",
      slug: ws.slug,
      type_name: data.type_name,
      path: ws.path,
      attempts: ws.attempts,
      mode: ws.mode,
      instance_id: instance?.id ?? null,
    }));
    delete workspaces[ws.slug];
    return;
  }

  if (msg.topic === "types.validation_failed") {
    ctx.log("warn", `[${ws.slug}] validation failed (${data.phase}) attempt ${ws.attempts}/${config.max_attempts}`);
    if (ws.attempts >= config.max_attempts) {
      ctx.log("error", `[${ws.slug}] giving up after ${ws.attempts} attempts`);
      ctx.respond(JSON.stringify({
        status: "failed",
        slug: ws.slug,
        path: ws.path,
        phase: data.phase,
        errors: data.errors?.slice(0, 2000),
        attempts: ws.attempts,
        mode: ws.mode,
      }));
      delete workspaces[ws.slug];
      return;
    }
    await runWorkspaceJob(ctx, ws, buildRetryPrompt(ws.path, ws.request, data.phase ?? "unknown", data.errors ?? ""), config);
  }
}

interface WorkspaceSnapshot {
  slug: string;
  path: string;
  type_name: string | null;
  registered: boolean;
  instance_id: string | null;
  in_progress: boolean;
  attempts: number;
  files_count: number;
  modified_at: number;
}

function readTypeName(workspacePath: string): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(workspacePath, "config.json"), "utf-8")) as { name?: unknown };
    return typeof cfg.name === "string" ? cfg.name : null;
  } catch { return null; }
}

function countFiles(dir: string, depthLeft = 4): number {
  if (depthLeft < 0 || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name), depthLeft - 1);
    else n += 1;
  }
  return n;
}

function snapshotWorkspaces(monorepoRoot: string, workspaces: WorkspacesState): WorkspaceSnapshot[] {
  const dynamicDir = path.join(monorepoRoot, "nodes", "_dynamic");
  if (!fs.existsSync(dynamicDir)) return [];
  const brain = BrainService.current;
  const out: WorkspaceSnapshot[] = [];
  for (const e of fs.readdirSync(dynamicDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith("dev-")) continue;
    const wsPath = path.join(dynamicDir, e.name);
    if (!fs.existsSync(path.join(wsPath, "config.json"))) continue;
    const typeName = readTypeName(wsPath);
    const registered = typeName !== null && (brain?.typeRegistry.has(typeName) ?? false);
    const liveInstance = registered && typeName
      ? (brain?.getNetworkSnapshot()?.find((n) => n.type === typeName) ?? null)
      : null;
    let modifiedAt = 0;
    try { modifiedAt = fs.statSync(wsPath).mtimeMs; } catch { /* ignore */ }
    out.push({
      slug: e.name,
      path: wsPath,
      type_name: typeName,
      registered,
      instance_id: liveInstance?.id ?? null,
      in_progress: e.name in workspaces,
      attempts: workspaces[e.name]?.attempts ?? 0,
      files_count: countFiles(wsPath),
      modified_at: modifiedAt,
    });
  }
  return out.sort((a, b) => b.modified_at - a.modified_at);
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified_at?: number;
  children?: FileNode[];
}

export function readTree(root: string, rel = "", depthLeft = 5): FileNode[] {
  if (depthLeft < 0) return [];
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out: FileNode[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    if (e.name.startsWith(".") && e.name !== ".gitignore") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const childAbs = path.join(abs, e.name);
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(childAbs); } catch { /* gone */ }
    if (e.isDirectory()) {
      out.push({
        name: e.name, path: childRel, is_dir: true,
        modified_at: stat?.mtimeMs,
        children: readTree(root, childRel, depthLeft - 1),
      });
    } else {
      out.push({
        name: e.name, path: childRel, is_dir: false,
        size: stat?.size, modified_at: stat?.mtimeMs,
      });
    }
  }
  return out;
}

function publishWorkspaces(ctx: NodeContext, monorepoRoot: string, workspaces: WorkspacesState): void {
  const items = snapshotWorkspaces(monorepoRoot, workspaces);
  ctx.publish("dev.workspaces", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ items }) },
    metadata: { items, ts: new Date().toISOString() },
  });
}

function publishFiles(ctx: NodeContext, monorepoRoot: string, msg: Message): void {
  const body = parseJsonContent(msg);
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!slug) {
    ctx.publish("dev.files", {
      type: "text",
      criticality: 1,
      payload: { content: JSON.stringify({ error: "missing slug" }) },
      metadata: { error: "missing slug" },
    });
    return;
  }
  const wsPath = path.join(monorepoRoot, "nodes", "_dynamic", slug);
  if (!fs.existsSync(wsPath)) {
    ctx.publish("dev.files", {
      type: "text",
      criticality: 1,
      payload: { content: JSON.stringify({ slug, error: "not found" }) },
      metadata: { slug, error: "not found" },
    });
    return;
  }
  const tree = readTree(wsPath);
  ctx.publish("dev.files", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ slug, tree }) },
    metadata: { slug, tree, ts: new Date().toISOString() },
  });
}

function publishCliList(ctx: NodeContext, cliRegistry: CLIRegistry, defaultCli: string): void {
  const available = cliRegistry.getAvailableCLIs();
  ctx.publish("dev.cli.available", {
    type: "text",
    criticality: 1,
    payload: { content: JSON.stringify({ clis: available, default: defaultCli }) },
    metadata: { clis: available, default: defaultCli },
  });
}

export const handler: NodeHandler = async (ctx) => {
  if (ctx.messages.length === 0) {
    ctx.sleep([{ type: "any" }]);
    return;
  }

  const config = getConfig(ctx.node.config_overrides ?? {});
  const cliRegistry = CLIRegistry.getInstance();
  await cliRegistry.initialize();
  const monorepoRoot = resolveMonorepoRoot();
  const workspaces = getWorkspaces(ctx.state);

  for (const msg of ctx.messages) {
    if (msg.topic === "dev.workspaces.list") {
      publishWorkspaces(ctx, monorepoRoot, workspaces);
      continue;
    }
    if (msg.topic === "dev.files.tree") {
      publishFiles(ctx, monorepoRoot, msg);
      continue;
    }
    if (msg.topic === "dev.cli.list") {
      publishCliList(ctx, cliRegistry, config.cli);
      continue;
    }
    if (msg.topic === "dev.improve") {
      await handleImproveRequest(ctx, msg, workspaces, config, cliRegistry, monorepoRoot);
      continue;
    }
    if (msg.topic.startsWith("types.")) {
      await handleValidationFeedback(ctx, msg, workspaces, config);
      // Network changed — refresh the workspaces list for any UI listening.
      publishWorkspaces(ctx, monorepoRoot, workspaces);
      continue;
    }
    // Default: any other message is a "create new node" request. Keeps
    // dev.request as the canonical entry but also accepts whatever the
    // brain or chat node forwards (legacy behaviour).
    await handleNewRequest(ctx, msg, workspaces, config, cliRegistry, monorepoRoot);
  }
};
