import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { type AddressInfo, createServer } from 'node:net';

import { ClamAvInstreamScannerAdapter } from './clamav-instream-scanner.adapter';

async function scannerServer(reply: string) {
  let resolveContent!: (content: Buffer) => void;
  const content = new Promise<Buffer>((resolve) => {
    resolveContent = resolve;
  });
  const server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const command = Buffer.from('zINSTREAM\0', 'ascii');
      if (
        received.length < command.length ||
        !received.subarray(0, command.length).equals(command)
      ) {
        return;
      }
      const parts: Buffer[] = [];
      let offset = command.length;
      while (received.length >= offset + 4) {
        const size = received.readUInt32BE(offset);
        if (size === 0) {
          resolveContent(Buffer.concat(parts));
          socket.end(`${reply}\0`);
          return;
        }
        if (received.length < offset + 4 + size) {
          return;
        }
        parts.push(received.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    content,
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('ClamAvInstreamScannerAdapter', () => {
  it.each([
    ['stream: OK', 'CLEAN'],
    ['stream: Eicar-Test-Signature FOUND', 'INFECTED'],
  ] as const)('maps the clamd INSTREAM reply %s', async (reply, expected) => {
    const testServer = await scannerServer(reply);
    const adapter = new ClamAvInstreamScannerAdapter(
      new ConfigService({
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: testServer.port,
        CLAMAV_SCAN_TIMEOUT_MS: 5_000,
      }),
    );
    const bytes = Buffer.from('actual-minio-object-bytes');

    try {
      await expect(
        adapter.scan({
          content: (async function* () {
            yield bytes;
          })(),
          maximumBytes: 1024,
        }),
      ).resolves.toBe(expected);
      await expect(testServer.content).resolves.toEqual(bytes);
    } finally {
      await testServer.close();
    }
  });
});
