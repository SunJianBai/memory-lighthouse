import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection, type Socket } from 'node:net';

import type {
  MalwareScannerPort,
  MalwareScanInput,
  MalwareScanVerdict,
} from '../ports/malware-scanner.port';
import { MalwareScannerUnavailableError } from '../ports/malware-scanner.port';

const CLAMAV_CHUNK_BYTES = 1024 * 1024;
const CLAMAV_MAX_REPLY_BYTES = 4096;

/** Streams the actual MinIO object bytes through clamd's framed INSTREAM API. */
@Injectable()
export class ClamAvInstreamScannerAdapter implements MalwareScannerPort {
  private readonly host: string | undefined;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST')?.trim() || undefined;
    this.port = this.integerConfig(config, 'CLAMAV_PORT', 3310, 1, 65_535);
    this.timeoutMs = this.integerConfig(
      config,
      'CLAMAV_SCAN_TIMEOUT_MS',
      120_000,
      1_000,
      300_000,
    );
  }

  async scan(input: MalwareScanInput): Promise<MalwareScanVerdict> {
    if (!this.host) {
      throw new MalwareScannerUnavailableError();
    }

    const socket = createConnection({ host: this.host, port: this.port });
    // A permanent listener prevents a late transport error from becoming an
    // unhandled EventEmitter error while operation-specific promises reject.
    socket.on('error', () => undefined);
    const deadline = setTimeout(() => {
      socket.destroy(new MalwareScannerUnavailableError());
    }, this.timeoutMs);
    deadline.unref();

    try {
      await this.connect(socket);
      await this.write(socket, Buffer.from('zINSTREAM\0', 'ascii'));

      let totalBytes = 0;
      for await (const value of input.content) {
        const chunk = Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
        totalBytes += chunk.length;
        if (totalBytes > input.maximumBytes) {
          throw new MalwareScannerUnavailableError();
        }
        for (
          let offset = 0;
          offset < chunk.length;
          offset += CLAMAV_CHUNK_BYTES
        ) {
          const part = chunk.subarray(offset, offset + CLAMAV_CHUNK_BYTES);
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(part.length);
          await this.write(socket, length);
          await this.write(socket, part);
        }
      }
      await this.write(socket, Buffer.alloc(4));

      const response = await this.readResponse(socket);
      if (/(?:^|:)\s*OK$/.test(response)) {
        return 'CLEAN';
      }
      if (/(?:^|:)\s*.+\sFOUND$/.test(response)) {
        return 'INFECTED';
      }
      throw new MalwareScannerUnavailableError();
    } catch (error) {
      if (error instanceof MalwareScannerUnavailableError) {
        throw error;
      }
      // Iterable errors are intentionally preserved. The deep scanner uses a
      // private policy error to distinguish malformed content from transport
      // outages without exposing clamd response details.
      if (error instanceof Error && error.name === 'AssetContentPolicyError') {
        throw error;
      }
      throw new MalwareScannerUnavailableError();
    } finally {
      clearTimeout(deadline);
      socket.destroy();
    }
  }

  private connect(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const connected = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new MalwareScannerUnavailableError());
      };
      const cleanup = () => {
        socket.off('connect', connected);
        socket.off('error', failed);
        socket.off('close', failed);
      };
      socket.once('connect', connected);
      socket.once('error', failed);
      socket.once('close', failed);
    });
  }

  private write(socket: Socket, content: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.write(content, (error) => {
        if (error) {
          reject(new MalwareScannerUnavailableError());
        } else {
          resolve();
        }
      });
    });
  }

  private readResponse(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      let response = Buffer.alloc(0);
      const received = (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > CLAMAV_MAX_REPLY_BYTES) {
          cleanup();
          reject(new MalwareScannerUnavailableError());
          return;
        }
        const terminator = response.indexOf(0);
        if (terminator >= 0) {
          cleanup();
          resolve(response.subarray(0, terminator).toString('utf8').trim());
        }
      };
      const failed = () => {
        cleanup();
        reject(new MalwareScannerUnavailableError());
      };
      const cleanup = () => {
        socket.off('data', received);
        socket.off('error', failed);
        socket.off('close', failed);
        socket.off('end', failed);
      };
      socket.on('data', received);
      socket.once('error', failed);
      socket.once('close', failed);
      socket.once('end', failed);
    });
  }

  private integerConfig(
    config: ConfigService,
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const raw = config.get<string | number>(name);
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new MalwareScannerUnavailableError();
    }
    return value;
  }
}
