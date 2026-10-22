import { createFederation } from "@fedify/fedify";
import { configure, getConsoleSink } from "@logtape/logtape";
import { platform } from "../../platform/index.ts";
import { AP } from "../../config/activitypub.ts";

// Without a sink, everything below the application — signature verification,
// delivery, Fedify's own retries — reports to nobody.
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: "fedify", sinks: ["console"], lowestLevel: "info" },
    { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
  ],
});

export const federation = createFederation<void>({
  kv: platform.kv,

  // With a queue, delivery is retried with backoff; without one it is sent
  // inline and a failure is final. Which applies is a property of the host.
  ...(platform.queue ? { queue: platform.queue } : {}),

  // Two hosts on purpose: the handle's domain serves one static WebFinger
  // document, the actor's home runs everything else. Fedify emits the canonical
  // handle for the first and builds every URL against the second.
  origin: {
    handleHost: AP.handleHost,
    webOrigin: `https://${AP.actorHost}`,
  },
});

const registrations = new Set<"shared" | "site">();

export function registerOnce(name: "shared" | "site", register: () => void): void {
  if (registrations.has(name)) return;
  register();
  registrations.add(name);
}
