import * as http from "node:http";
import * as https from "node:https";

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

let flushInterval: ReturnType<typeof setInterval> | null = null;
let pushUrl = "";

const EVENT_METRICS: Record<string, string> = {
  "0 BOOTSTRAP": "acs_event_bootstrap_total",
  "1 BOOT": "acs_event_boot_total",
  "2 PERIODIC": "acs_event_periodic_total",
  "3 SCHEDULED": "acs_event_scheduled_total",
  "4 VALUE CHANGE": "acs_event_value_change_total",
  "5 KICKED": "acs_event_kicked_total",
  "6 CONNECTION REQUEST": "acs_event_connection_request_total",
  "7 TRANSFER COMPLETE": "acs_event_transfer_complete_total",
  "8 DIAGNOSTICS COMPLETE": "acs_event_diagnostics_complete_total",
  "M Reboot": "acs_event_m_reboot",
  "M Scheduled Inform": "acs_event_m_sched_inform",
  "M Download": "acs_event_m_download",
};

function labelString(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  return (
    "{" +
    entries
      .map(
        ([k, v]) =>
          `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
      )
      .join(",") +
    "}"
  );
}

export function inc(name: string, labels: Record<string, string>): void {
  if (!pushUrl) return;
  const key = `${name}${labelString(labels)}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function set(
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  if (!pushUrl) return;
  const key = `${name}${labelString(labels)}`;
  gauges.set(key, value);
}

export function recordEvent(
  deviceId: string,
  events: string[],
  timestamp: number,
): void {
  if (!pushUrl) return;
  for (const e of events) {
    const eventMetric = EVENT_METRICS[e];
    if (eventMetric) inc(eventMetric, {});
    if (e === "2 PERIODIC") {
      set("genieacs_last_inform", { device_id: deviceId }, timestamp / 1000);
    }
  }
}

export function recordFault(code: string, channel: string): void {
  if (!pushUrl) return;
  inc(`genieacs_faults_${code}_total`, { channel });
}

export function flush(): void {
  if (!pushUrl) return;
  if (counters.size === 0 && gauges.size === 0) return;

  const lines: string[] = [];
  for (const [key, value] of counters) lines.push(`${key} ${value}`);
  for (const [key, value] of gauges) lines.push(`${key} ${value}`);

  counters.clear();
  gauges.clear();

  const body = lines.join("\n") + "\n";
  const url = new URL("/api/v1/import/prometheus", pushUrl);
  const mod = url.protocol === "https:" ? https : http;

  const req = mod.request(
    url,
    { method: "POST", headers: { "Content-Type": "text/plain" } },
    () => {},
  );
  req.setTimeout(5000, () => req.destroy());
  req.on("error", () => {});
  req.end(body);
}

export function startFlushing(url: string, intervalMs: number): void {
  pushUrl = url;
  flushInterval = setInterval(flush, intervalMs);
  flushInterval.unref();
}

export function stop(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  flush();
}
