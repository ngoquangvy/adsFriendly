import { endianness } from "node:os";

const MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_HELPER_MESSAGE_BYTES = 1024 * 1024;
const BYTE_ORDER = endianness();

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.byteLength > MAX_HELPER_MESSAGE_BYTES) {
    throw new Error("Native message exceeds Chrome's 1 MiB host limit.");
  }
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  writeLength(frame, body.byteLength);
  body.copy(frame, 4);
  return frame;
}

export class NativeMessageReader {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: unknown[] = [];
    while (this.pending.byteLength >= 4) {
      const length = readLength(this.pending);
      if (length > MAX_EXTENSION_MESSAGE_BYTES) {
        throw new Error("Native message exceeds Chrome's 64 MiB input limit.");
      }
      if (this.pending.byteLength < length + 4) break;
      const body = this.pending.subarray(4, length + 4);
      messages.push(JSON.parse(body.toString("utf8")));
      this.pending = this.pending.subarray(length + 4);
    }
    return messages;
  }
}

function readLength(buffer: Buffer): number {
  return BYTE_ORDER === "BE" ? buffer.readUInt32BE(0) : buffer.readUInt32LE(0);
}

function writeLength(buffer: Buffer, length: number): void {
  if (BYTE_ORDER === "BE") buffer.writeUInt32BE(length, 0);
  else buffer.writeUInt32LE(length, 0);
}
