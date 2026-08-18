import { StepData } from "./segmenter";
import { sendNoteOn, sendNoteOff, sendStart, sendStop, sendClock, sendSysEx } from "./webmidi";

// ─── Elektron SysEx constants ────────────────────────────────────────────────
// Manufacturer ID: 00 20 3C
// Digitakt (original) product ID: 0x0E
// Digitakt 2 product ID: community-reported as 0x12 — configurable in UI
// Protocol: Single pattern track dump

const ELEKTRON_MFR = [0x00, 0x20, 0x3c];

// Elektron 7-bit packing: every 7 input bytes → 8 output bytes.
// First byte of each group carries the MSBs (bit 7) of the following 7 bytes.
function pack7bit(input: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 7) {
    const chunk = input.slice(i, Math.min(i + 7, input.length));
    let msb = 0;
    for (let j = 0; j < chunk.length; j++) {
      if (chunk[j] & 0x80) msb |= 1 << j;
    }
    out.push(msb & 0x7f);
    for (let j = 0; j < chunk.length; j++) {
      out.push(chunk[j] & 0x7f);
    }
  }
  return out;
}

// Elektron checksum: sum of all body bytes, masked to 7 bits.
function elektronChecksum(bytes: number[]): number {
  return bytes.reduce((acc, b) => (acc + b) & 0x7f, 0);
}

// ─── SysEx pattern write ──────────────────────────────────────────────────────
// Sends a simplified Elektron pattern track dump to the device.
// Format (pre-packing):
//   [version=0x01] [trackIndex 0-15] [stepCount] [for each step: note, vel, len, flags]
//
// NOTE: The Digitakt 2 SysEx protocol is reverse-engineered from community documentation
// (Elektron Transfer app traffic analysis). Device ID 0x12 is community-reported for DT2.
// Verify against your firmware version before relying on this in a live set.

export function buildPatternSysEx(
  deviceId: number,
  trackIndex: number,
  steps: StepData[],
): Uint8Array {
  const stepCount = steps.length;

  // Raw data bytes (before 7-bit packing)
  const raw: number[] = [
    0x01,                    // format version
    trackIndex & 0x0f,       // track 0-15
    stepCount & 0x7f,        // number of steps
  ];

  for (const step of steps) {
    raw.push(step.note & 0x7f);
    raw.push(step.velocity & 0x7f);
    raw.push(step.length & 0x7f);
    raw.push(step.active ? 0x01 : 0x00); // trig on/off flag
  }

  const packed = pack7bit(new Uint8Array(raw));
  const checksum = elektronChecksum(packed);

  // Full SysEx body (without the F0/F7 framing — sendSysEx adds those)
  return new Uint8Array([
    ...ELEKTRON_MFR,
    deviceId & 0x7f,
    0x00,         // MIDI channel / OS sub-version byte (0 = any)
    0x68,         // command: pattern data
    ...packed,
    checksum,
  ]);
}

export async function sendPatternSysEx(
  output: MIDIOutput,
  deviceId: number,
  trackIndex: number,
  steps: StepData[],
): Promise<void> {
  const sysexBody = buildPatternSysEx(deviceId, trackIndex, steps);
  sendSysEx(output, Array.from(sysexBody));
}

// ─── Pre-flight safety: Universal Device Inquiry handshake ────────────────────
// A blind pattern write to a mis-identified device (or a non-Elektron on the
// same port) can corrupt a project slot or wedge the MIDI port on Elektron
// hardware. Before writing, we send the STANDARD MIDI Universal Non-Realtime
// Identity Request (F0 7E 7F 06 01 F7) and listen for an Identity Reply.
// We verify the Elektron manufacturer ID (00 20 3C) before allowing the write.
// This is a read-only, universally safe message understood by virtually all
// MIDI gear, so it cannot itself harm the device.

const IDENTITY_REQUEST = [0x7e, 0x7f, 0x06, 0x01]; // sendSysEx adds F0 … F7

export interface DeviceIdentity {
  isElektron: boolean;
  manufacturer: number[];
  familyCode: number[];
  raw: number[];
}

/**
 * Send an Identity Request and wait up to `timeoutMs` for a reply on the
 * matching input. Returns the parsed identity, or null if nothing answered.
 * The caller supplies the paired MIDIInput (same device as the output).
 */
export function requestDeviceIdentity(
  output: MIDIOutput,
  input: MIDIInput,
  timeoutMs = 400,
): Promise<DeviceIdentity | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DeviceIdentity | null) => {
      if (settled) return;
      settled = true;
      input.removeEventListener("midimessage", onMessage as EventListener);
      resolve(result);
    };

    const onMessage = (event: MIDIMessageEvent) => {
      const data = Array.from(event.data ?? []);
      // Identity Reply: F0 7E <ch> 06 02 <mfr…> … F7
      if (data.length < 7 || data[0] !== 0xf0 || data[1] !== 0x7e) return;
      if (data[3] !== 0x06 || data[4] !== 0x02) return;

      // Manufacturer ID: either 1 byte (non-zero) or 3 bytes (leading 0x00).
      let mfr: number[];
      let familyStart: number;
      if (data[5] === 0x00) {
        mfr = [data[5], data[6], data[7]];
        familyStart = 8;
      } else {
        mfr = [data[5]];
        familyStart = 6;
      }
      const isElektron = mfr.length === 3 && mfr[0] === 0x00 && mfr[1] === 0x20 && mfr[2] === 0x3c;
      finish({
        isElektron,
        manufacturer: mfr,
        familyCode: data.slice(familyStart, familyStart + 2),
        raw: data,
      });
    };

    input.addEventListener("midimessage", onMessage as EventListener);
    sendSysEx(output, IDENTITY_REQUEST);
    setTimeout(() => finish(null), timeoutMs);
  });
}

export type PreflightResult =
  | { ok: true; identity: DeviceIdentity }
  | { ok: false; reason: "no-reply" | "not-elektron"; identity: DeviceIdentity | null };

/**
 * Verify the target really is an Elektron device before a destructive SysEx
 * write. If no paired input is available we cannot verify — the caller decides
 * whether to proceed (we surface that as a distinct, explicit path rather than
 * silently writing).
 */
export async function preflightVerify(
  output: MIDIOutput,
  input: MIDIInput | null,
  timeoutMs = 400,
): Promise<PreflightResult | null> {
  if (!input) return null; // cannot verify; caller must decide
  const identity = await requestDeviceIdentity(output, input, timeoutMs);
  if (!identity) return { ok: false, reason: "no-reply", identity: null };
  if (!identity.isElektron) return { ok: false, reason: "not-elektron", identity };
  return { ok: true, identity };
}

// ─── Real-time playback ───────────────────────────────────────────────────────
// Plays steps as MIDI notes in real time using Web Audio / performance.now() timing.
// The DT2 must be in LIVE RECORDING mode to capture this to its sequencer.
// Send 24 MIDI clock ticks per quarter note at the given BPM so the DT2 syncs.

export interface PlaybackHandle {
  stop: () => void;
}

export function playStepsRealtime(
  output: MIDIOutput,
  channel: number,
  steps: StepData[],
  bpm: number,
  onStep?: (index: number) => void,
): PlaybackHandle {
  let stopped = false;
  const ch = channel;

  // Each step = one 16th note at the given BPM
  const sixteenthMs = (60_000 / bpm) / 4;
  // MIDI clock: 24 pulses per quarter note = 6 pulses per 16th note
  const clockIntervalMs = sixteenthMs / 6;

  sendStart(output);

  let stepIndex = 0;
  let clockCount = 0;
  let lastClock = performance.now();
  let lastStep = performance.now();
  let animFrame: number;

  const tick = (now: number) => {
    if (stopped) return;

    // MIDI clock pulses
    while (now - lastClock >= clockIntervalMs) {
      sendClock(output);
      lastClock += clockIntervalMs;
      clockCount++;
    }

    // Step triggers (every 6 clock pulses = one 16th note)
    while (now - lastStep >= sixteenthMs && stepIndex < steps.length) {
      const step = steps[stepIndex];
      if (step.active) {
        sendNoteOn(output, ch, step.note, step.velocity);
        const noteOffAt = lastStep + sixteenthMs * 0.9;
        const noteOffDelay = noteOffAt - performance.now();
        if (noteOffDelay > 0) {
          setTimeout(() => sendNoteOff(output, ch, step.note), noteOffDelay);
        } else {
          sendNoteOff(output, ch, step.note);
        }
      }
      onStep?.(stepIndex);
      lastStep += sixteenthMs;
      stepIndex++;
    }

    if (stepIndex >= steps.length) {
      sendStop(output);
      return;
    }

    animFrame = requestAnimationFrame(tick);
  };

  animFrame = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(animFrame);
      sendStop(output);
    },
  };
}
