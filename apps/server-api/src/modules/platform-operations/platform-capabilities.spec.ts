import { describe, expect, it } from '@jest/globals';

import { capabilitiesForPlatformRoles } from './platform-capabilities';

describe('platform capabilities', () => {
  it('grants operational reads to administrators without granting original-content access', () => {
    expect(capabilitiesForPlatformRoles(['ADMIN'])).toEqual(
      expect.arrayContaining([
        'PLATFORM_DASHBOARD_READ',
        'PLATFORM_USERS_READ',
        'PLATFORM_AUDIT_LOGS_READ',
        'INSPECTION_GRANTS_APPROVE',
      ]),
    );
    expect(capabilitiesForPlatformRoles(['ADMIN'])).not.toContain(
      'CONTENT_INSPECTION_READ',
    );
  });

  it('limits content auditors to audit and inspected-content workflows', () => {
    expect(capabilitiesForPlatformRoles(['CONTENT_AUDITOR'])).toEqual([
      'PLATFORM_AUDIT_LOGS_READ',
      'INSPECTION_GRANTS_READ',
      'INSPECTION_GRANTS_REQUEST',
      'INSPECTION_GRANTS_REVOKE',
      'CONTENT_INSPECTION_READ',
    ]);
  });

  it('deduplicates capabilities for operators with both platform roles', () => {
    const capabilities = capabilitiesForPlatformRoles([
      'ADMIN',
      'CONTENT_AUDITOR',
    ]);

    expect(new Set(capabilities).size).toBe(capabilities.length);
  });
});
