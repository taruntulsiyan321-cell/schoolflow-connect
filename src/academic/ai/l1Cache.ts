/**
 * L1 in-process cache for AE/EIE snapshots.
 * Keyed by tenant / student / capability / data_version.
 */

export type L1CacheKeyParts = {
  tenantId: string;
  studentId: string;
  capability: string;
  dataVersion: string;
};

export function buildL1CacheKey(parts: L1CacheKeyParts): string {
  return `l1:${parts.tenantId}:${parts.studentId}:${parts.capability}:${parts.dataVersion}`;
}

type Entry<T> = { value: T; expiresAt: number };

export class AeSnapshotL1Cache {
  private store = new Map<string, Entry<unknown>>();

  constructor(private readonly defaultTtlMs = 60_000) {}

  get<T>(key: string): T | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  getOrSet<T>(key: string, factory: () => T, ttlMs = this.defaultTtlMs): T {
    const existing = this.get<T>(key);
    if (existing !== null) return existing;
    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  async getOrSetAsync<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<{ value: T; cache_hit: boolean }> {
    const existing = this.get<T>(key);
    if (existing !== null) return { value: existing, cache_hit: true };
    const value = await factory();
    this.set(key, value, ttlMs);
    return { value, cache_hit: false };
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/** Process-wide L1 for client/helper use. Edge has its own isolate instance. */
export const globalAeL1Cache = new AeSnapshotL1Cache();
