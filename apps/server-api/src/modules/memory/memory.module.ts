import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity/identity.module';
import { S3ObjectStorageAdapter } from './adapters/s3-object-storage.adapter';
import { ClamAvInstreamScannerAdapter } from './adapters/clamav-instream-scanner.adapter';
import { AssetApplicationService } from './asset.application.service';
import { AssetContentScannerService } from './asset-content-scanner.service';
import { AssetLifecycleQueue } from './asset-lifecycle.queue';
import { AssetLifecycleRunner } from './asset-lifecycle.runner';
import { AesGcmDataEncryptionAdapter } from './crypto/aes-gcm-data-encryption.adapter';
import { AssetController } from './http/asset.controller';
import { MedicationController } from './http/medication.controller';
import { MemoryController } from './http/memory.controller';
import { TrustedContactController } from './http/trusted-contact.controller';
import { MedicationApplicationService } from './medication.application.service';
import { MemoryApplicationService } from './memory.application.service';
import { TrustedContactApplicationService } from './trusted-contact.application.service';
import {
  DATA_ENCRYPTION_PORT,
  MALWARE_SCANNER_PORT,
  OBJECT_STORAGE_PORT,
} from './memory.constants';

@Module({
  imports: [PrismaModule, IdentityModule, HouseholdModule],
  controllers: [
    MemoryController,
    AssetController,
    MedicationController,
    TrustedContactController,
  ],
  providers: [
    AesGcmDataEncryptionAdapter,
    {
      provide: DATA_ENCRYPTION_PORT,
      useExisting: AesGcmDataEncryptionAdapter,
    },
    S3ObjectStorageAdapter,
    { provide: OBJECT_STORAGE_PORT, useExisting: S3ObjectStorageAdapter },
    ClamAvInstreamScannerAdapter,
    {
      provide: MALWARE_SCANNER_PORT,
      useExisting: ClamAvInstreamScannerAdapter,
    },
    MemoryApplicationService,
    AssetApplicationService,
    AssetContentScannerService,
    AssetLifecycleQueue,
    AssetLifecycleRunner,
    MedicationApplicationService,
    TrustedContactApplicationService,
  ],
  exports: [
    MemoryApplicationService,
    AssetApplicationService,
    AssetContentScannerService,
    MedicationApplicationService,
    TrustedContactApplicationService,
    DATA_ENCRYPTION_PORT,
  ],
})
export class MemoryModule {}
