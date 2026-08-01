import { FAMILY_TASK_STATUS } from '../care-workflow.constants';
import { InvalidFamilyTaskTransitionException } from '../care-workflow.errors';

export function assertTaskCanClaim(status: string): void {
  if (status !== FAMILY_TASK_STATUS.open) {
    throw new InvalidFamilyTaskTransitionException(status, 'CLAIM');
  }
}

export function assertTaskCanFinish(status: string, action: string): void {
  if (
    status !== FAMILY_TASK_STATUS.open &&
    status !== FAMILY_TASK_STATUS.claimed
  ) {
    throw new InvalidFamilyTaskTransitionException(status, action);
  }
}
