import 'server-only';
import { query } from '@/lib/db';
import { getApplicantByUserId, statusFromReview, sumsubConfigured } from '@/lib/sumsub';
import { demoMode } from '@/lib/demo';

/**
 * Stores a Sumsub review in client_verifications (one row per application, db/schema.sql) and mirrors the outcome onto
 * the client's dashboard uploads (client_documents.review_status), which is what the dashboard reads.
 * Called by the webhook (POST /api/sumsub/webhook) and by syncFromSumsub (asks Sumsub directly).
 * `userId` is the applicant's externalUserId = client_applications.id.
 */
const FILE_STATUS = { approved: 'approved', rejected: 'rejected', resubmit: 'rejected', pending: 'pending', started: 'pending' };

export async function saveVerification(userId, { applicantId, levelName, reviewStatus, reviewResult, event }) {
  if (!/^\d+$/.test(String(userId))) return null;
  const status = statusFromReview({ reviewStatus, reviewResult });
  try {
    await query(
      `INSERT INTO client_verifications
         (application_id, status, applicant_id, level_name, review_status, review_answer, reject_type, reject_labels, moderation_comment, client_comment, last_event)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         applicant_id = COALESCE(VALUES(applicant_id), applicant_id),
         level_name = COALESCE(VALUES(level_name), level_name),
         review_status = VALUES(review_status),
         review_answer = VALUES(review_answer),
         reject_type = VALUES(reject_type),
         reject_labels = VALUES(reject_labels),
         moderation_comment = VALUES(moderation_comment),
         client_comment = VALUES(client_comment),
         last_event = COALESCE(VALUES(last_event), last_event)`,
      [
        userId,
        status,
        applicantId ?? null,
        levelName ?? null,
        reviewStatus ?? null,
        reviewResult?.reviewAnswer ?? null,
        reviewResult?.reviewRejectType ?? null,
        JSON.stringify(reviewResult?.rejectLabels ?? []),
        reviewResult?.moderationComment ?? null,
        reviewResult?.clientComment ?? null,
        event ?? null
      ]
    );
  } catch (err) {
    // no such application (foreign key): e.g. a webhook for an applicant from another system
    if (err?.code === 'ER_NO_REFERENCED_ROW_2') return null;
    throw err;
  }
  await query('UPDATE client_documents SET review_status = ? WHERE application_id = ?', [FILE_STATUS[status], userId]);
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

/**
 * syncFromSumsub for pages that show the status (back office, the client's page and outcome pages): picks up a decision
 * made in the Sumsub dashboard (e.g. a manual approval) when its webhook can't reach us, as in local development.
 * Best effort: on any error the stored status stays. → our status, or null when not checked.
 */
export async function refreshFromSumsub(userId) {
  if (!sumsubConfigured() || demoMode()) return null;
  try {
    return await syncFromSumsub(String(userId));
  } catch (err) {
    console.warn(`[sumsub] refresh ${userId}: ${err.message}`);
    return null;
  }
}
