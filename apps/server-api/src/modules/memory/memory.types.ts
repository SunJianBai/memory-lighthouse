import type { UserPrincipal } from '../identity/identity.types';

export interface MemoryRevisionView {
  id: string;
  revisionNo: number;
  content: string;
  source: string;
  changeReason: string | null;
  createdByMemberId: string;
  createdAt: string;
}

export interface MemoryView {
  id: string;
  householdId: string;
  recipientId: string;
  kind: string;
  title: string;
  sensitivity: string;
  verificationStatus: string;
  status: string;
  currentRevision: MemoryRevisionView;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemoryPage {
  items: MemoryView[];
  nextCursor: string | null;
}

export interface CreateMemoryCommand {
  principal: UserPrincipal;
  householdId: string;
  recipientId: string;
  kind: string;
  title: string;
  content: string;
  sensitivity: string;
  verificationStatus: string;
  source?: string;
}

export interface UpdateMemoryCommand {
  principal: UserPrincipal;
  householdId: string;
  memoryId: string;
  kind?: string;
  title?: string;
  content?: string;
  sensitivity?: string;
  verificationStatus?: string;
  changeReason?: string;
  version: number;
}

export interface ListMemoriesQuery {
  principal: UserPrincipal;
  householdId: string;
  recipientId: string;
  cursor?: string;
  limit?: number;
}

export interface AssetView {
  id: string;
  householdId: string;
  recipientId: string | null;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: string;
  scanStatus: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface UploadIntentView {
  asset: AssetView;
  method: 'PUT';
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface CreateUploadIntentCommand {
  principal: UserPrincipal;
  householdId: string;
  recipientId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: string;
}

export interface CompleteUploadCommand {
  principal: UserPrincipal;
  householdId: string;
  assetId: string;
  version: number;
}

export interface AssetDeletionView {
  assetId: string;
  status: 'PENDING_DELETE' | 'DELETED';
  accepted: true;
}

export interface MedicationView {
  id: string;
  householdId: string;
  recipientId: string;
  name: string;
  alias: string | null;
  purpose: string | null;
  requirements: string | null;
  containerLabel: string | null;
  containerLocation: string | null;
  status: string;
  recordOrigin: 'FAMILY_ENTERED';
  clinicalAssessmentPerformed: false;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateMedicationCommand {
  principal: UserPrincipal;
  householdId: string;
  recipientId: string;
  name: string;
  alias?: string | null;
  purpose?: string | null;
  requirements?: string | null;
  containerLabel?: string | null;
  containerLocation?: string | null;
}

export interface UpdateMedicationCommand {
  principal: UserPrincipal;
  householdId: string;
  medicationId: string;
  name?: string;
  alias?: string | null;
  purpose?: string | null;
  requirements?: string | null;
  containerLabel?: string | null;
  containerLocation?: string | null;
  version: number;
}

export interface TrustedContactView {
  id: string;
  householdId: string;
  recipientId: string;
  householdMemberId: string | null;
  name: string;
  relationshipLabel: string;
  phone: string | null;
  email: string | null;
  priority: number;
  canViewEvidence: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateTrustedContactCommand {
  principal: UserPrincipal;
  householdId: string;
  recipientId: string;
  householdMemberId?: string | null;
  name: string;
  relationshipLabel: string;
  phone?: string | null;
  email?: string | null;
  priority: number;
  canViewEvidence: boolean;
}

export interface UpdateTrustedContactCommand {
  principal: UserPrincipal;
  householdId: string;
  contactId: string;
  householdMemberId?: string | null;
  name?: string;
  relationshipLabel?: string;
  phone?: string | null;
  email?: string | null;
  priority?: number;
  canViewEvidence?: boolean;
  version: number;
}
