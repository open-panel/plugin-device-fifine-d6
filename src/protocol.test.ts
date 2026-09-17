import { describe, expect, it } from "vitest";
import {
  computeDeviceId,
  defaultKeycodeMap,
  DEFAULT_IMAGE_KEY_MAP,
  diffButtonStates,
  mapPositionToImageKey,
  parseInputReport,
  REPORT_CODE_OFFSET,
  REPORT_STATE_OFFSET,
} from "./protocol.js";

describe("computeDeviceId", () => {
  it("distinguishes sibling HID interfaces of the same physical device", () => {
    const base = { vendorId: 0x3142, productId: 0x60, serialNumber: "ABC123" };
    const id0 = computeDeviceId({ ...base, interface: 0 });
    const id1 = computeDeviceId({ ...base, interface: 1 });
    expect(id0).not.toBe(id1);
  });

  it("stays stable across reconnects when the OS-assigned path changes but the interface doesn't", () => {
    const idA = computeDeviceId({
      vendorId: 1,
      productId: 2,
      serialNumber: "S",
      path: "\\\\?\\A",
      interface: 0,
    });
    const idB = computeDeviceId({
      vendorId: 1,
      productId: 2,
      serialNumber: "S",
      path: "\\\\?\\B",
      interface: 0,
    });
    expect(idA).toBe(idB);
  });

  it("falls back to vendor/product id when no serial number is reported", () => {
    expect(computeDeviceId({ vendorId: 1, productId: 2, interface: 0 })).toBe("fifine-d6-1-2-if0");
  });
});

/** Builds a synthetic report matching the real D6 layout: 9-byte preamble + code + state flag. */
function buildReport(code: number, pressed: boolean, length = 16): Uint8Array {
  const report = new Uint8Array(length);
  report[REPORT_CODE_OFFSET] = code;
  report[REPORT_STATE_OFFSET] = pressed ? 1 : 0;
  return report;
}

describe("parseInputReport", () => {
  const map = defaultKeycodeMap(15);

  it("extracts the pressed button position when the state flag is set", () => {
    const report = buildReport(3, true); // keycode 3 -> position 2
    expect(parseInputReport(report, map)).toEqual(new Set([2]));
  });

  it("returns an empty set once the state flag clears, even though the code byte keeps its last value", () => {
    // This is the exact shape that used to cause a stuck "phantom" press:
    // the code byte (3) is unchanged, only the state flag drops to 0.
    const report = buildReport(3, false);
    expect(parseInputReport(report, map)).toEqual(new Set());
  });

  it("returns an empty set for an all-zero (fully idle) report", () => {
    const report = new Uint8Array(16);
    expect(parseInputReport(report, map)).toEqual(new Set());
  });

  it("ignores a code outside the configured button range", () => {
    const report = buildReport(99, true);
    expect(parseInputReport(report, map)).toEqual(new Set());
  });
});

describe("diffButtonStates", () => {
  it("computes newly pressed and newly released positions", () => {
    const diff = diffButtonStates(new Set([1, 2]), new Set([2, 3]));
    expect(diff.pressed).toEqual([3]);
    expect(diff.released).toEqual([1]);
  });
});

describe("mapPositionToImageKey", () => {
  // Ground truth from a real USB capture of FIFINE's own official software:
  // setting an icon on the first physical button sent BAT with key byte
  // 0x0b (11), i.e. 0-based key 10 — see protocol.ts#DEFAULT_IMAGE_KEY_MAP.
  it("maps position 0 to key 10, confirmed via USB capture", () => {
    expect(mapPositionToImageKey(0)).toBe(10);
  });

  it("uses the confirmed table by default for the rest of the positions", () => {
    expect(mapPositionToImageKey(4)).toBe(14);
    expect(mapPositionToImageKey(5)).toBe(5);
    expect(mapPositionToImageKey(10)).toBe(0);
    expect(mapPositionToImageKey(14)).toBe(4);
  });

  it("is a genuine permutation of every position", () => {
    const mapped = Array.from({ length: 15 }, (_, position) => mapPositionToImageKey(position));
    expect(new Set(mapped)).toEqual(new Set(Array.from({ length: 15 }, (_, i) => i)));
  });

  it("accepts a custom table override, e.g. for a different device revision", () => {
    const identity = Array.from({ length: 15 }, (_, i) => i);
    expect(mapPositionToImageKey(7, identity)).toBe(7);
  });

  it("falls back to identity when the position has no entry in the table", () => {
    expect(mapPositionToImageKey(99, DEFAULT_IMAGE_KEY_MAP)).toBe(99);
  });
});
