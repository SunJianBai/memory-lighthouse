import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { AssetApplicationService } from './asset.application.service';
import { AssetContentScannerService } from './asset-content-scanner.service';
import {
  AssetLifecycleQueue,
  type AssetLifecycleJob,
} from './asset-lifecycle.queue';
import { AssetLifecycleRunner } from './asset-lifecycle.runner';

const scanJob: AssetLifecycleJob = {
  id: '01EVENT00000000000000000000',
  assetId: '01ASSET00000000000000000000',
  eventType: 'asset.scan-requested',
  attemptCount: 1,
};

const deleteJob: AssetLifecycleJob = {
  ...scanJob,
  eventType: 'asset.delete-requested',
};

function setup(
  claim: AssetLifecycleQueue['claim'],
  overrides: {
    scanPendingAsset?: AssetContentScannerService['scanPendingAsset'];
    deletePendingAsset?: AssetApplicationService['deletePendingAsset'];
  } = {},
) {
  const recoverMissingJobs = jest.fn(async () => null);
  const claimMock = jest.fn(claim);
  const acknowledge = jest.fn(async () => undefined);
  const retry = jest.fn(async () => undefined);
  const queue = {
    recoverMissingJobs,
    claim: claimMock,
    acknowledge,
    retry,
  } as unknown as AssetLifecycleQueue;
  const scanner = {
    scanPendingAsset:
      overrides.scanPendingAsset ?? jest.fn(async () => 'PROCESSED' as const),
  } as AssetContentScannerService;
  const assets = {
    deletePendingAsset:
      overrides.deletePendingAsset ?? jest.fn(async () => undefined),
  } as AssetApplicationService;
  const runner = new AssetLifecycleRunner(
    queue,
    scanner,
    assets,
    new ConfigService({
      NODE_ENV: 'test',
      ASSET_LIFECYCLE_CONCURRENCY: 2,
      ASSET_LIFECYCLE_BATCH_SIZE: 2,
      ASSET_LIFECYCLE_RETRY_BASE_MS: 100,
      ASSET_LIFECYCLE_RETRY_MAX_MS: 1_000,
    }),
  );
  return {
    runner,
    queue,
    scanner,
    assets,
    acknowledge,
    retry,
  };
}

describe('AssetLifecycleRunner', () => {
  it('does not process the same job twice when ticks overlap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scanPendingAsset = jest.fn(async () => {
      await gate;
      return 'PROCESSED' as const;
    });
    const claim = jest
      .fn<AssetLifecycleQueue['claim']>()
      .mockResolvedValueOnce(scanJob)
      .mockResolvedValue(null);
    const { runner } = setup(claim, { scanPendingAsset });

    const first = runner.tick(new Date('2026-08-02T00:00:00.000Z'));
    while (scanPendingAsset.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await runner.tick(new Date('2026-08-02T00:00:01.000Z'));
    expect(scanPendingAsset).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('retries a failed deletion and marks DELETED only through the service', async () => {
    const claim = jest
      .fn<AssetLifecycleQueue['claim']>()
      .mockResolvedValueOnce(deleteJob)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...deleteJob, attemptCount: 2 })
      .mockResolvedValue(null);
    const deletePendingAsset = jest
      .fn<AssetApplicationService['deletePendingAsset']>()
      .mockRejectedValueOnce(new Error('object store unavailable'))
      .mockResolvedValueOnce(undefined);
    const { runner, acknowledge, retry } = setup(claim, {
      deletePendingAsset,
    });
    const firstNow = new Date('2026-08-02T00:00:00.000Z');

    await runner.tick(firstNow);
    expect(retry).toHaveBeenCalledWith(
      deleteJob,
      new Date('2026-08-02T00:00:00.100Z'),
      'ASSET_DELETE_FAILED',
    );
    expect(acknowledge).not.toHaveBeenCalled();

    await runner.tick(new Date('2026-08-02T00:01:00.000Z'));
    expect(deletePendingAsset).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});
