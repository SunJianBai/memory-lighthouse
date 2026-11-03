import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RoutineListQueryDto, RoutineLifecycleDto } from './care-workflow.dto';
import { RoutinesController } from './routines.controller';
import type { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type { UserPrincipal } from '../../identity/identity.types';

describe('routine lifecycle HTTP contract', () => {
  it.each(['1', 'TRUE', 'yes', '', true, ['true']])(
    'rejects ambiguous includePaused %j',
    async (value) => {
      expect(
        await validate(
          plainToInstance(RoutineListQueryDto, { includePaused: value }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it.each([{}, { includePaused: 'true' }, { includePaused: 'false' }])(
    'accepts strict opt-in %j',
    async (query) => {
      expect(
        await validate(plainToInstance(RoutineListQueryDto, query)),
      ).toHaveLength(0);
    },
  );
  it.each(['1', -1, 1.2, null])(
    'rejects a non-integer body version %j',
    async (version) => {
      expect(
        await validate(plainToInstance(RoutineLifecycleDto, { version })),
      ).not.toHaveLength(0);
    },
  );
  it('requires an idempotency header before dispatch', () => {
    const workflow = { pauseRoutine: jest.fn(), resumeRoutine: jest.fn() };
    const controller = new RoutinesController(
      workflow as unknown as CareWorkflowApplicationService,
    );
    expect(() =>
      controller.pause({} as UserPrincipal, 'household', 'routine', {
        version: 0,
      }),
    ).toThrow();
    expect(() =>
      controller.resume({} as UserPrincipal, 'household', 'routine', {
        version: 0,
      }),
    ).toThrow();
    expect(workflow.pauseRoutine).not.toHaveBeenCalled();
    expect(workflow.resumeRoutine).not.toHaveBeenCalled();
  });
});
