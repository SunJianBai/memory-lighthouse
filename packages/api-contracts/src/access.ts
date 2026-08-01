import { z } from 'zod';

export const householdRoles = ['OWNER', 'CAREGIVER', 'VIEWER'] as const;
export const householdRoleSchema = z.enum(householdRoles);
export type HouseholdRole = z.infer<typeof householdRoleSchema>;

export const careAuthorityKeys = [
  'canViewProfile',
  'canManageProfile',
  'canViewMemory',
  'canManageMemory',
  'canViewConversation',
  'canManageRoutine',
  'canActivateDevice',
  'canRemoteCall',
  'canManageConsent',
] as const;

export const careAuthorityKeySchema = z.enum(careAuthorityKeys);
export type CareAuthorityKey = z.infer<typeof careAuthorityKeySchema>;

export const careAuthoritiesSchema = z.record(
  careAuthorityKeySchema,
  z.boolean(),
);
export type CareAuthorities = z.infer<typeof careAuthoritiesSchema>;
