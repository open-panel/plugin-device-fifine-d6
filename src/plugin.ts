import { definePlugin } from "@open-panel/plugin-sdk";
import { FifineD6Driver } from "./driver.js";

/**
 * The plugin half of the adapter: everything hardware-specific lives in the
 * modules beside this file, and the daemon learns about the D6 only because
 * this manifest was found in a plugin directory (specs.md Rule 3 — no
 * vendor-specific logic in core, and no vendor-specific import either).
 *
 * The driver is constructed here rather than by the daemon, which is what
 * lets it read its own env-var overrides (config.ts) without the daemon
 * carrying a single FIFINE-shaped setting.
 */
export default definePlugin({
  devices: [new FifineD6Driver()],
});
