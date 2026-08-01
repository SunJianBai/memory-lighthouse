export const CONTENT_INSPECTION_NOTIFICATION_TYPE =
  'CONTENT_INSPECTION_PERFORMED';
export const CONTENT_INSPECTION_NOTIFICATION_TEMPLATE =
  'content_inspection_performed';
export const CONTENT_INSPECTION_NOTIFICATION_PRIORITY = 'HIGH';
export const ADMIN_ACCESS_PAGE_DEFAULT = 20;
export const ADMIN_ACCESS_PAGE_MAX = 100;
export const ADMIN_ACCESS_SERIALIZABLE_RETRY_LIMIT = 3;

export const ADMIN_ACCESS_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  MEMORY_REVISION: '记忆修订原文',
  CONVERSATION_UTTERANCE: '对话话轮原文',
};

export function contentInspectionDedupeKey(inspectionId: string): string {
  return `content-inspection:${inspectionId}`;
}
