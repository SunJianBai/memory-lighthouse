import { createRequire } from 'node:module';

import { Injectable } from '@nestjs/common';

import type { PasswordHasherPort } from '../ports/password-hasher.port';

const ARGON2_OPTIONS = {
  // @node-rs/argon2 Algorithm.Argon2id. Kept numeric here so the optional
  // native Adapter can be compiled before deployment dependencies are installed.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

interface Argon2Module {
  hash(
    password: string | Buffer,
    options: typeof ARGON2_OPTIONS,
  ): Promise<string>;
  verify(encoded: string, password: string | Buffer): Promise<boolean>;
}

let loadedArgon2: Argon2Module | undefined;

function argon2(): Argon2Module {
  loadedArgon2 ??= createRequire(__filename)('@node-rs/argon2') as Argon2Module;
  return loadedArgon2;
}

@Injectable()
export class Argon2PasswordHasherAdapter implements PasswordHasherPort {
  async hash(password: string): Promise<Uint8Array<ArrayBuffer>> {
    const encoded = await argon2().hash(password, ARGON2_OPTIONS);
    return Uint8Array.from(Buffer.from(encoded, 'utf8'));
  }

  async verify(
    password: string,
    passwordHash: Uint8Array<ArrayBufferLike> | null,
  ): Promise<boolean> {
    if (!passwordHash) {
      // Keep the missing-account path expensive so it does not disclose account
      // existence through a cheap password-verification branch.
      await argon2().hash(password, ARGON2_OPTIONS);
      return false;
    }

    try {
      return await argon2().verify(
        Buffer.from(passwordHash).toString('utf8'),
        password,
      );
    } catch {
      return false;
    }
  }
}
