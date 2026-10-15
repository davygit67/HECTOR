import { SENSOR_LIMITS } from '../../src/shared/sensor.js';

/** Native stdout is uint32 LE length + PMF1 or status JSON, ordered on one pipe. */
export class PacketReader {
  private prefix = Buffer.alloc(4);
  private prefixUsed = 0;
  private packet: Buffer | null = null;
  private used = 0;
  private failed = false;
  constructor(private receive: (packet: Buffer) => void) {}
  push(chunk: Uint8Array) {
    if (this.failed) throw new Error('Native frame reader has failed.');
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (!this.packet) {
          const length = Math.min(4 - this.prefixUsed, chunk.length - offset);
          this.prefix.set(chunk.subarray(offset, offset + length), this.prefixUsed);
          this.prefixUsed += length; offset += length;
          if (this.prefixUsed < 4) continue;
          const size = this.prefix.readUInt32LE();
          if (size < 8 || size > SENSOR_LIMITS.maxFrameBytes + SENSOR_LIMITS.maxHeaderBytes) throw new Error('Native frame exceeds the size limit.');
          this.packet = Buffer.allocUnsafe(size); this.used = 0; this.prefixUsed = 0;
        }
        const length = Math.min(this.packet.length - this.used, chunk.length - offset);
        this.packet.set(chunk.subarray(offset, offset + length), this.used); this.used += length; offset += length;
        if (this.used === this.packet.length) {
          const packet = this.packet; this.packet = null; this.used = 0; this.receive(packet);
        }
      }
    } catch (error) { this.failed = true; this.packet = null; throw error; }
  }
  finish() { if (this.packet || this.prefixUsed) throw new Error('Native stream ended during a frame.'); }
}
