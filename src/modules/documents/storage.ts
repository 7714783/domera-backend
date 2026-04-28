import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// Object-storage contract. Default impl is local-disk (good for dev + self-host);
// swap for an S3 adapter by implementing `ObjectStorage` and binding to the
// OBJECT_STORAGE provider in documents.module.ts.
export interface ObjectStorage {
  put(
    key: string,
    body: Buffer,
    meta: { mimeType?: string | null },
  ): Promise<{ key: string; sizeBytes: number }>;
  get(key: string): Promise<Buffer>;
  del(key: string): Promise<void>;
  describe(): string;
}

export class LocalDiskStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(this.root, safe);
  }

  async put(key: string, body: Buffer): Promise<{ key: string; sizeBytes: number }> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    return { key, sizeBytes: body.length };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async del(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (e: any) {
      if (e && e.code !== 'ENOENT') throw e;
    }
  }

  describe(): string {
    return `local-disk:${this.root}`;
  }
}
