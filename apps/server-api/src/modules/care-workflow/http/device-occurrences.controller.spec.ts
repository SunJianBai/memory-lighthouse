import { describe, expect, it, jest } from '@jest/globals';

import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { DevicePrincipal } from '../../device-activation/device-activation.types';
import { DeviceAuthGuard } from '../../device-activation/http/device-auth.guard';
import type { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type { OccurrenceView } from '../care-workflow.types';
import { DeviceOccurrencesController } from './device-occurrences.controller';

const principal: DevicePrincipal = {
  kind: 'DEVICE',
  tokenId: 'device-token-1',
  credentialId: 'device-credential-1',
  credentialFamilyId: 'device-family-1',
  deviceId: 'device-1',
  bindingId: 'binding-1',
  householdId: 'household-1',
  recipientId: 'recipient-1',
  bindingVersion: 1,
  capabilities: ['COMPANION'],
};

const occurrence = {
  id: 'occurrence-1',
  householdId: principal.householdId,
  recipientId: principal.recipientId,
  routineId: 'routine-1',
  scheduleId: 'schedule-1',
  routineTitle: '早餐提醒',
  routineType: 'MEAL',
  instructions: '请按家属记录吃早餐',
  contentProvenance: 'FAMILY_ENTERED_VERBATIM' as const,
  scheduledAtUtc: '2026-08-01T08:00:00.000Z',
  scheduledLocalDate: '2026-08-01',
  status: 'AWAITING_CONFIRMATION',
  confirmationDeadlineAt: '2026-08-01T08:20:00.000Z',
  escalationAt: '2026-08-01T08:30:00.000Z',
  completedAt: null,
  version: 2,
} satisfies OccurrenceView;

function harness() {
  const workflow = {
    listCurrentOccurrencesForDevice: jest.fn(async () => [occurrence]),
    confirmOccurrenceByDevice: jest.fn(async () => ({
      ...occurrence,
      status: 'CONFIRMED',
      version: 3,
    })),
    requestFamilyContactByDevice: jest.fn(async () => ({
      accepted: true as const,
      careEventId: 'care-event-1',
      familyTaskId: 'family-task-1',
      occurrenceId: occurrence.id,
      taskStatus: 'OPEN',
    })),
  };
  return {
    workflow,
    controller: new DeviceOccurrencesController(
      workflow as unknown as CareWorkflowApplicationService,
    ),
  };
}

describe('DeviceOccurrencesController routes', () => {
  it('exposes the guarded current-occurrence GET route', async () => {
    const test = harness();

    await expect(test.controller.current(principal)).resolves.toEqual([
      occurrence,
    ]);
    expect(test.workflow.listCurrentOccurrencesForDevice).toHaveBeenCalledWith(
      principal,
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, DeviceOccurrencesController),
    ).toBe('device');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        // Nest stores route metadata on the unbound prototype handler.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.current,
      ),
    ).toBe('occurrences/current');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.current,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DeviceOccurrencesController),
    ).toContain(DeviceAuthGuard);
  });

  it('derives the binding from the principal on the strict-version POST route', async () => {
    const test = harness();
    const body = {
      version: 2,
      idempotencyKey: 'confirm-route-1',
      source: 'RECIPIENT_BUTTON' as const,
    };

    await expect(
      test.controller.confirm(
        principal,
        occurrence.id,
        body.idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ status: 'CONFIRMED', version: 3 });
    expect(test.workflow.confirmOccurrenceByDevice).toHaveBeenCalledWith(
      principal,
      occurrence.id,
      body,
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.confirm,
      ),
    ).toBe('occurrences/:occurrenceId/confirm');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.confirm,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('exposes the device family-contact command as an accepted POST route', async () => {
    const test = harness();
    const body = {
      idempotencyKey: 'family-contact-route-1',
      source: 'RECIPIENT_BUTTON' as const,
      occurrenceId: occurrence.id,
    };

    await expect(
      test.controller.requestFamilyContact(
        principal,
        body.idempotencyKey,
        body,
      ),
    ).resolves.toMatchObject({ accepted: true, taskStatus: 'OPEN' });
    expect(test.workflow.requestFamilyContactByDevice).toHaveBeenCalledWith(
      principal,
      body,
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.requestFamilyContact,
      ),
    ).toBe('family-contact-requests');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        DeviceOccurrencesController.prototype.requestFamilyContact,
      ),
    ).toBe(RequestMethod.POST);
  });
});
