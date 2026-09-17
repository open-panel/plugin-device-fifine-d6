import { HID, type Device as HidDeviceInfo } from "node-hid";
import type {
  DeviceCapabilities,
  DeviceEvent,
  DeviceEventListener,
  DeviceInfo,
} from "@open-panel/shared";
import type { DeckDevice, Disposable } from "@open-panel/device-sdk";
import type { FifineD6Config } from "./config.js";
import {
  computeDeviceId,
  defaultKeycodeMap,
  diffButtonStates,
  mapPositionToImageKey,
  parseInputReport,
} from "./protocol.js";
import {
  buildClearButtonCommand,
  buildFlushCommand,
  buildImageDataReports,
  buildInitCommands,
  buildSendImageHeader,
  buildSetBrightnessCommand,
} from "./commands.js";

const DEBUG_RAW = process.env.OPENPANEL_FIFINE_DEBUG_RAW === "1";
/**
 * Pacing delay between HID writes. Originally 8ms, guessed to work around
 * what looked like dropped reports — but a real USB capture of FIFINE's own
 * software (see ../README.md "Image output") shows it pacing packets under
 * 1ms apart, so that guess was both unnecessary and, via `setTimeout`'s
 * Windows scheduling overhead, the dominant cost of a render pass (~1-1.8s
 * for a 15-button page). Defaulting to 0 per that evidence; override if a
 * particular unit turns out to need real spacing after all.
 */
const WRITE_PACING_MS = Number(process.env.OPENPANEL_FIFINE_WRITE_DELAY_MS ?? 0);

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

type PendingUpdate = { kind: "image"; jpeg: Buffer } | { kind: "clear" };

/**
 * DeckDevice implementation for the FIFINE D6, backed by node-hid. All raw
 * HID details (report bytes, keycodes, command framing) are normalized here
 * and never leak past this class (specs.md #10).
 */
export class FifineD6Device implements DeckDevice {
  readonly id: string;
  readonly capabilities: DeviceCapabilities;

  private hid: HID | undefined;
  private readonly listeners = new Set<DeviceEventListener>();
  private readonly keycodeMap: Map<number, number>;
  private pressedPositions = new Set<number>();
  private initialized = false;

  /**
   * Queued per-position updates for the batch currently being built.
   * `flush()` is what actually writes to the device, once, after every
   * position has been queued — see its doc comment.
   */
  private readonly pending = new Map<number, PendingUpdate>();

  /**
   * The last blank frame the host handed us, reused across every clear — see
   * `clearButtonImage` for why blanking needs a real frame at all.
   *
   * The encode cache that used to sit here is gone with the encoding: the host
   * caches frames now, which is also where it belongs, since it is the host
   * that re-renders every button on a profile switch.
   */
  private blankJpeg: Buffer | undefined;

  constructor(
    private readonly hidInfo: HidDeviceInfo,
    private readonly config: FifineD6Config,
  ) {
    this.id = computeDeviceId(hidInfo);
    this.capabilities = {
      buttons: config.buttonCount,
      hasDisplay: true,
      supportsButtonImages: true,
      supportsButtonLabels: false,
      hasEncoders: false,
      hasTouchscreen: false,
      supportsImageCalibration: true,
      // What this hardware wants, declared rather than produced: the host fits
      // the icon, applies the calibration and encodes it, and this adapter
      // writes the bytes. `size` is the one protocol detail that could not be
      // recovered from the plugin binary (see ../README.md "Image output"), so
      // it stays configurable to be corrected empirically.
      buttonImage: {
        size: config.imageSize,
        encoding: "jpeg",
        quality: 90,
        rotationDegrees: config.imageRotation,
      },
    };
    this.keycodeMap = defaultKeycodeMap(config.buttonCount);
  }

  get info(): DeviceInfo {
    return {
      id: this.id,
      driverId: "fifine-d6",
      vendor: this.hidInfo.manufacturer ?? "FIFINE",
      product: this.hidInfo.product ?? "D6",
      serialNumber: this.hidInfo.serialNumber,
      capabilities: this.capabilities,
      state: this.hid ? "connected" : "disconnected",
    };
  }

  async connect(): Promise<void> {
    if (!this.hidInfo.path) throw new Error("HID device path is unavailable");
    const hid = new HID(this.hidInfo.path);
    hid.on("data", (data: Buffer) => this.handleReport(data));
    hid.on("error", () => {
      // The device likely disappeared. Close our handle; DriverRegistry's
      // next poll will notice it's gone from discover() and mark it
      // disconnected/reconnecting — we must not throw here (specs.md Rule 6).
      this.hid = undefined;
    });
    this.hid = hid;
    this.initialized = false;
  }

  async disconnect(): Promise<void> {
    this.hid?.close();
    this.hid = undefined;
  }

  onEvent(listener: DeviceEventListener): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /**
   * Queues one button's icon — nothing is written to the device until
   * `flush()`. `jpeg` arrives ready: the host encoded it to exactly what
   * `capabilities.buttonImage` asked for, calibration included.
   */
  async setButtonImage(position: number, jpeg: Buffer): Promise<void> {
    this.pending.set(position, { kind: "image", jpeg });
  }

  /**
   * Queues blanking one button's image — nothing is written to the device
   * until `flush()`.
   *
   * `blank` is a black frame from the host, kept because `CLE` (see
   * commands.ts) is ported from mirajazz sight-unseen for this device and, on
   * real hardware, only clears the centre of the button — the previous icon's
   * edge pixels stay on screen as a leftover border. Sending a full black
   * frame through the same image path is what actually overwrites every pixel.
   */
  async clearButtonImage(position: number, blank?: Buffer): Promise<void> {
    if (blank) this.blankJpeg = blank;
    if (position === 0xff) {
      for (let p = 0; p < this.config.buttonCount; p++) this.pending.set(p, { kind: "clear" });
      return;
    }
    this.pending.set(position, { kind: "clear" });
  }

  /**
   * Writes every queued `setButtonImage`/`clearButtonImage` call, then
   * commits with one STP. Sent in natural position order — the position is
   * remapped to the device's own key numbering via `mapPositionToImageKey`
   * for the "key" byte in each BAT/CLE header, which is what actually
   * addresses the physical button (confirmed against a real USB capture of
   * FIFINE's own software — see ../README.md "Image output").
   */
  async flush(): Promise<void> {
    const hid = this.requireConnectedHid();
    await this.ensureInitialized(hid);

    const startedAt = Date.now();
    let reportCount = 0;
    for (const [position, update] of this.pending) {
      const key = mapPositionToImageKey(position, this.config.imageKeyMap);
      if (update.kind === "image") {
        reportCount += await this.sendImage(hid, position, key, update.jpeg);
      } else {
        await this.sendClear(hid, key);
        reportCount += 1;
        // CLE alone leaves the previous icon's edge pixels on screen; the
        // black frame is what overwrites them. Absent only if the host gave
        // us none, in which case CLE on its own is all there is to send.
        const blank = this.getBlankJpeg();
        if (blank) reportCount += await this.sendImage(hid, position, key, blank);
      }
    }
    const pendingCount = this.pending.size;
    this.pending.clear();

    await this.writeReport(hid, "STP-flush", buildFlushCommand());
    reportCount += 1;

    if (DEBUG_RAW) {
      console.log(
        `[fifine-d6 flush] ${this.id}: positions=${pendingCount} reports=${reportCount} tookMs=${Date.now() - startedAt}`,
      );
    }
  }

  private async sendImage(hid: HID, position: number, key: number, jpeg: Buffer): Promise<number> {
    if (DEBUG_RAW) {
      console.log(
        `[fifine-d6 img] ${this.id}: position=${position} key=${key} imageSize=${this.config.imageSize} jpegBytes=${jpeg.length}`,
      );
    }
    await this.writeReport(
      hid,
      `BAT-header[pos${position} key${key}]`,
      buildSendImageHeader(key, jpeg.length),
    );
    const chunks = buildImageDataReports(jpeg);
    for (const [i, chunk] of chunks.entries()) {
      await this.writeReport(hid, `BAT-data[pos${position} ${i}/${chunks.length}]`, chunk);
    }
    return 1 + chunks.length;
  }

  /** The host's black frame, or nothing — see `clearButtonImage`. */
  private getBlankJpeg(): Buffer | undefined {
    return this.blankJpeg;
  }

  private async sendClear(hid: HID, key: number): Promise<void> {
    await this.writeReport(hid, `CLE[key${key}]`, buildClearButtonCommand(key));
  }

  private async ensureInitialized(hid: HID): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const [dis, lig] = buildInitCommands();
    await this.writeReport(hid, "DIS", dis!);
    await this.writeReport(hid, "LIG-init", lig!);
    await this.writeReport(
      hid,
      "LIG-brightness",
      buildSetBrightnessCommand(this.config.brightness),
    );
  }

  private requireConnectedHid(): HID {
    if (!this.hid) throw new Error(`Device ${this.id} is not connected`);
    return this.hid;
  }

  /**
   * Writes one HID output report. `WRITE_PACING_MS` defaults to 0 — see its
   * definition for why an earlier, non-zero guess was actively harmful.
   */
  private async writeReport(hid: HID, label: string, report: Buffer): Promise<void> {
    const bytesWritten = hid.write(Array.from(report));
    if (DEBUG_RAW) {
      console.log(
        `[fifine-d6 write] ${this.id}: ${label} length=${report.length} bytesWritten=${bytesWritten}`,
      );
    }
    await delay(WRITE_PACING_MS);
  }

  private handleReport(data: Buffer): void {
    if (DEBUG_RAW) {
      // Diagnostic escape hatch for reverse-engineering the real report
      // format on hardware we haven't validated yet (see ../README.md).
      console.log(`[fifine-d6 raw] ${this.id}: ${data.toString("hex")}`);
    }
    const current = parseInputReport(data, this.keycodeMap);
    const diff = diffButtonStates(this.pressedPositions, current);
    this.pressedPositions = current;
    const timestamp = Date.now();
    for (const position of diff.pressed) {
      this.emit({ type: "button.press", deviceId: this.id, position, timestamp });
    }
    for (const position of diff.released) {
      this.emit({ type: "button.release", deviceId: this.id, position, timestamp });
    }
  }

  private emit(event: DeviceEvent): void {
    for (const l of this.listeners) l(event);
  }
}
