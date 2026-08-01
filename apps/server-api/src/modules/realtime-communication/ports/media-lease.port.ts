export interface MediaLeaseOwner {
  ownerType: 'AI_COMPANION' | 'REMOTE_ASSISTANCE';
  ownerId: string;
  leaseId: string;
}

export interface MediaLeasePort {
  acquire(
    bindingId: string,
    owner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean>;
  renew(
    bindingId: string,
    owner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean>;
  transfer(
    bindingId: string,
    currentOwner: MediaLeaseOwner,
    nextOwner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean>;
  release(bindingId: string, owner: MediaLeaseOwner): Promise<void>;
  current(bindingId: string): Promise<MediaLeaseOwner | null>;
}
