import type {
  LiveKitJoinTicketCommand,
  VerifiedLiveKitWebhook,
} from '../realtime.types';

export interface LiveKitPort {
  issueJoinTicket(command: LiveKitJoinTicketCommand): Promise<{
    token: string;
    url: string;
    expiresAt: Date;
  }>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
  verifyWebhook(
    rawBody: string,
    authorization: string | undefined,
  ): Promise<VerifiedLiveKitWebhook>;
}
