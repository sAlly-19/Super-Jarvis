import type { EmailWriteRequest } from '../../../../shared/types/email'
import type { EmailWriteScope } from '../contracts'
export function checkOriginalAttachmentBudget(request: EmailWriteRequest, scope: EmailWriteScope): void {
  if (!['send', 'draft_update', 'forward'].includes(request.type)) return
  const originals = scope.source?.attachments ?? []
  const additions = request.type === 'send' ? [] : scope.attachments
  if (originals.length + additions.length > 10 || originals.some(item => item.sizeBytes === null || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0)
    || originals.reduce((sum, item) => sum + item.sizeBytes!, 0) + additions.reduce((sum, item) => sum + item.bytes.byteLength, 0) > 10485760) throw new Error('email_attachment_limit')
}
