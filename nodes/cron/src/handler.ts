import type { NodeHandler, NodeInfo, NodeOnSpawn, NodeTeardown } from "@brain/sdk";
import { BrainService } from "@brain/core";

/**
 * Cron — generic configurable tick source.
 *
 * Same self-driven shape as `clock`: a setInterval in onSpawn pumps the
 * configured topic at the configured interval. Other nodes that want
 * periodic work subscribe to that topic instead of polling themselves.
 */

interface CronConfig {
  topic: string;
  content: string | null;
  criticality: number;
  type: "text" | "alert";
  alert_title?: string;
  intervalMs: number;
}

function getConfig(overrides: Record<string, unknown>): CronConfig {
  return {
    topic: (overrides.topic as string | undefined) ?? "cron.tick",
    content: (overrides.content as string | undefined) ?? null,
    criticality: (overrides.criticality as number | undefined) ?? 0,
    type: (overrides.type as "text" | "alert" | undefined) ?? "text",
    alert_title: overrides.alert_title as string | undefined,
    intervalMs: parseIntervalToMs((overrides.interval as string | undefined) ?? "10s"),
  };
}

/** Cheap interval parser covering ms → year. Anything unparseable
 *  defaults to 10 seconds. */
function parseIntervalToMs(raw: string): number {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i);
  if (!m) return 10_000;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  switch (unit) {
    case "ms": return n;
    case "s": return n * 1_000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    case "w": return n * 604_800_000;
    case "y": return n * 31_557_600_000;
    default: return n * 1_000;
  }
}

const intervals = new Map<string, NodeJS.Timeout>();

function tick(info: NodeInfo, config: CronConfig): void {
  const bus = BrainService.current?.bus;
  if (!bus) return;
  if (config.type === "alert") {
    bus.publish({
      from: info.id,
      topic: config.topic,
      type: "alert",
      criticality: config.criticality,
      payload: {
        title: config.alert_title ?? "Cron alert",
        description: config.content ?? new Date().toISOString(),
      },
    });
  } else {
    bus.publish({
      from: info.id,
      topic: config.topic,
      type: "text",
      criticality: config.criticality,
      payload: { content: config.content ?? new Date().toISOString() },
    });
  }
}

export const onSpawn: NodeOnSpawn = (info: NodeInfo) => {
  const config = getConfig(info.config_overrides ?? {});
  const handle = setInterval(() => tick(info, config), config.intervalMs);
  intervals.set(info.id, handle);
};

export const teardown: NodeTeardown = (info: NodeInfo) => {
  const handle = intervals.get(info.id);
  if (handle) {
    clearInterval(handle);
    intervals.delete(info.id);
  }
};

// No bus input — handler is a stub for the framework loader.
export const handler: NodeHandler = () => Promise.resolve();
