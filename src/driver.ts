import { devices as listHidDevices } from "node-hid";
import type { DeckDevice, DeviceDriver } from "@openpanel/device-sdk";
import { loadFifineD6Config, type FifineD6Config } from "./config.js";
import { FifineD6Device } from "./hid-device.js";
import { computeDeviceId } from "./protocol.js";

/**
 * Discovers FIFINE D6 units over HID. No watch() is implemented — node-hid
 * has no hot-plug API — so DriverRegistry falls back to polling discover(),
 * which is also how it notices the device disappearing.
 */
export class FifineD6Driver implements DeviceDriver {
  readonly driverId = "fifine-d6";
  private readonly config: FifineD6Config;
  private readonly devices = new Map<string, FifineD6Device>();

  constructor(configOverrides: Partial<FifineD6Config> = {}) {
    this.config = loadFifineD6Config(configOverrides);
  }

  async discover(): Promise<DeckDevice[]> {
    if (!this.config.vendorId || !this.config.productId) {
      // Unconfigured — see this plugin's README.md for how to identify
      // your device's vendor/product id via `openpanel devices scan-hid`.
      return [];
    }

    const matches = listHidDevices(this.config.vendorId, this.config.productId).filter(
      (d) => this.config.usagePage === undefined || d.usagePage === this.config.usagePage,
    );

    const result: DeckDevice[] = [];
    const seenIds = new Set<string>();
    for (const hidInfo of matches) {
      const id = computeDeviceId(hidInfo);
      seenIds.add(id);
      let device = this.devices.get(id);
      if (!device) {
        device = new FifineD6Device(hidInfo, this.config);
        this.devices.set(id, device);
      }
      result.push(device);
    }
    // Drop cached devices that are no longer physically present so a later
    // reconnect creates a fresh handle instead of reusing a dead one.
    for (const id of this.devices.keys()) {
      if (!seenIds.has(id)) this.devices.delete(id);
    }
    return result;
  }
}
