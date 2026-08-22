import { describe, it, expect, vi } from 'vitest';
import {
  buildPatternSysEx,
  requestDeviceIdentity,
  preflightVerify,
} from './digitakt';
import type { StepData } from './segmenter';

// ─── Mock Web MIDI ports ──────────────────────────────────────────────────────
// The real MIDIOutput/MIDIInput come from the browser. We emulate just enough
// of the event model: an output that records what was sent, and an input that
// can be told to "reply" with a given SysEx byte array, dispatched to any
// registered midimessage listeners.

class MockOutput {
  sent: number[][] = [];
  name = 'Elektron Digitakt II';
  send(data: number[] | Uint8Array) {
    this.sent.push(Array.from(data));
  }
}

class MockInput {
  name = 'Elektron Digitakt II';
  private listeners: Array<(e: { data: Uint8Array }) => void> = [];
  // What this device replies with when it receives an Identity Request.
  // null = never replies (simulates a non-responding / non-SysEx device).
  reply: number[] | null = null;
  replyDelayMs = 5;

  addEventListener(_type: string, cb: EventListener) {
    this.listeners.push(cb as unknown as (e: { data: Uint8Array }) => void);
  }
  removeEventListener(_type: string, cb: EventListener) {
    this.listeners = this.listeners.filter((l) => l !== (cb as unknown));
  }
  // Simulate the device answering an outgoing request.
  fire() {
    if (this.reply === null) return;
    const bytes = new Uint8Array(this.reply);
    setTimeout(() => {
      for (const l of this.listeners) l({ data: bytes });
    }, this.replyDelayMs);
  }
}

// Standard MIDI Identity Reply framing:
//   F0 7E <ch> 06 02 <manufacturer…> <family/model/version…> F7
function elektronIdentityReply(): number[] {
  return [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x3c, 0x0d, 0x00, 0x01, 0x00, 0xf7];
}
function rolandIdentityReply(): number[] {
  // Roland = single-byte manufacturer 0x41 (not Elektron).
  return [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x41, 0x10, 0x00, 0x00, 0xf7];
}

function makePair(reply: number[] | null) {
  const output = new MockOutput();
  const input = new MockInput();
  input.reply = reply;
  return { output, input };
}

// requestDeviceIdentity resolves only after the reply fires OR the timeout, so
// we drive fake timers and flush the microtask queue between advances.
async function runHandshake<T>(
  input: MockInput,
  promise: Promise<T>,
): Promise<T> {
  input.fire();
  await vi.advanceTimersByTimeAsync(500);
  return promise;
}

describe('buildPatternSysEx', () => {
  const steps: StepData[] = [
    { note: 60, velocity: 100, length: 96, active: true },
    { note: 64, velocity: 80, length: 96, active: false },
  ];

  it('frames an Elektron manufacturer ID and pattern command', () => {
    const body = buildPatternSysEx(0x12, 0, steps);
    // Manufacturer ID 00 20 3C first, then device id.
    expect(Array.from(body.slice(0, 3))).toEqual([0x00, 0x20, 0x3c]);
    expect(body[3]).toBe(0x12); // device id
    // Command byte 0x68 must appear (pattern data).
    expect(Array.from(body)).toContain(0x68);
  });

  it('keeps every byte within 7-bit SysEx range (0x00-0x7F)', () => {
    const body = buildPatternSysEx(0x12, 3, steps);
    for (const b of body) {
      expect(b).toBeGreaterThanOrEqual(0x00);
      expect(b).toBeLessThanOrEqual(0x7f);
    }
  });
});

describe('requestDeviceIdentity', () => {
  it('parses a 3-byte Elektron manufacturer reply as isElektron', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(elektronIdentityReply());
    const p = requestDeviceIdentity(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const identity = await runHandshake(input, p);
    vi.useRealTimers();

    expect(identity).not.toBeNull();
    expect(identity!.isElektron).toBe(true);
    expect(identity!.manufacturer).toEqual([0x00, 0x20, 0x3c]);
    // The Identity Request must actually have been sent (F0 7E 7F 06 01 F7).
    expect(output.sent[0]).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
  });

  it('parses a single-byte non-Elektron manufacturer as isElektron=false', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(rolandIdentityReply());
    const p = requestDeviceIdentity(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const identity = await runHandshake(input, p);
    vi.useRealTimers();

    expect(identity).not.toBeNull();
    expect(identity!.isElektron).toBe(false);
    expect(identity!.manufacturer).toEqual([0x41]);
  });

  it('resolves null when the device never replies (timeout)', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(null); // never fires
    const p = requestDeviceIdentity(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    input.fire(); // no-op, reply is null
    await vi.advanceTimersByTimeAsync(500);
    const identity = await p;
    vi.useRealTimers();

    expect(identity).toBeNull();
  });

  it('ignores a truncated reply with no F7 terminator', async () => {
    vi.useFakeTimers();
    // Valid identity-reply header but missing the closing 0xF7 → incomplete
    // frame → must be rejected (fragmented/interleaved SysEx guard).
    const truncated = elektronIdentityReply().slice(0, -1); // drop F7
    const { output, input } = makePair(truncated);
    const p = requestDeviceIdentity(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const identity = await runHandshake(input, p);
    vi.useRealTimers();
    expect(identity).toBeNull();
  });

  it('ignores non-identity SysEx traffic and still times out', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]); // a REQUEST, not a reply (06 01)
    const p = requestDeviceIdentity(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const identity = await runHandshake(input, p);
    vi.useRealTimers();

    // data[4] is 0x01 (request) not 0x02 (reply) → must be ignored → null.
    expect(identity).toBeNull();
  });
});

describe('preflightVerify', () => {
  it('returns null (cannot verify) when there is no paired input', async () => {
    const { output } = makePair(null);
    const result = await preflightVerify(output as unknown as MIDIOutput, null, 400);
    expect(result).toBeNull();
  });

  it('returns ok:true for a verified Elektron device', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(elektronIdentityReply());
    const p = preflightVerify(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const result = await runHandshake(input, p);
    vi.useRealTimers();

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it('refuses (ok:false, not-elektron) a positively-wrong device', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(rolandIdentityReply());
    const p = preflightVerify(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    const result = await runHandshake(input, p);
    vi.useRealTimers();

    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.reason).toBe('not-elektron');
  });

  it('reports no-reply when a device is present but silent', async () => {
    vi.useFakeTimers();
    const { output, input } = makePair(null);
    const p = preflightVerify(
      output as unknown as MIDIOutput,
      input as unknown as MIDIInput,
      400,
    );
    input.fire();
    await vi.advanceTimersByTimeAsync(500);
    const result = await p;
    vi.useRealTimers();

    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.reason).toBe('no-reply');
  });
});
