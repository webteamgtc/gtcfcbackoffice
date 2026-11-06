import 'server-only';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { DOCUMENTS_BUCKET } from '@/lib/user';
import { getApplicantByUserId, statusFromReview } from '@/lib/sumsub';

/**
 * Stores a Sumsub review on the client (user_record.sumsub + kyc.verificationStatus) and mirrors the outcome onto the
 * client's uploaded files (metadata.sumsubStatus), which is what the dashboard reads.
 * Called by the webhook (POST /api/sumsub/webhook) and by syncVerification (asks Sumsub directly).
 */
const FILE_STATUS = { approved: 'approved', rejected: 'rejected', resubmit: 'rejected', pending: 'pending', started: 'pending' };

export async function saveVerification(userId, { applicantId, levelName, reviewStatus, reviewResult, event }) {
  if (!ObjectId.isValid(userId)) return null;
  const status = statusFromReview({ reviewStatus, reviewResult });
  const db = await getDb();
  const now = new Date();
  const { matchedCount } = await db.collection('user_record').updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        ...(applicantId ? { 'sumsub.applicantId': applicantId } : {}),
        ...(levelName ? { 'sumsub.levelName': levelName } : {}),
        'sumsub.reviewStatus': reviewStatus ?? null,
        'sumsub.reviewAnswer': reviewResult?.reviewAnswer ?? null,
        'sumsub.reviewRejectType': reviewResult?.reviewRejectType ?? null,
        'sumsub.rejectLabels': reviewResult?.rejectLabels ?? [],
        'sumsub.moderationComment': reviewResult?.moderationComment ?? null,
        'sumsub.clientComment': reviewResult?.clientComment ?? null,
        ...(event ? { 'sumsub.lastEvent': event } : {}),
        'sumsub.updatedAt': now,
        'kyc.verificationStatus': status
      }
    }
  );
  if (!matchedCount) return null;
  await db.collection(`${DOCUMENTS_BUCKET}.files`).updateMany({ 'metadata.userId': userId }, { $set: { 'metadata.sumsubStatus': FILE_STATUS[status] } });
  return status;
}

/** Pulls the applicant's current review from Sumsub and stores it. → our status, or 'not_started' when no applicant yet. */
export async function syncFromSumsub(userId) {
  const applicant = await getApplicantByUserId(userId);
  if (!applicant) return 'not_started';
  return saveVerification(userId, {
    applicantId: applicant.id,
    levelName: applicant.review?.levelName,
    reviewStatus: applicant.review?.reviewStatus,
    reviewResult: applicant.review?.reviewResult,
    event: 'sync'
  });
}
