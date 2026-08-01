import type {
  HouseholdInvitationDelivery,
  InvitationDeliveryPort,
} from '../ports/invitation-delivery.port';

/** Test-only adapter. It is intentionally not registered or exported by HouseholdModule. */
export class InMemoryInvitationDeliveryAdapter implements InvitationDeliveryPort {
  readonly sent: HouseholdInvitationDelivery[] = [];

  sendHouseholdInvitation(
    invitation: HouseholdInvitationDelivery,
  ): Promise<void> {
    this.sent.push(invitation);
    return Promise.resolve();
  }
}
