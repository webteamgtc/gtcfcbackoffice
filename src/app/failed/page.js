import VerificationResult, { requireOutcome } from '@/app/components/VerificationResult';
import { BRAND } from '@/lib/brand';
import '@/app/apply/apply.css';

export const metadata = { title: `Verification unsuccessful | ${BRAND.name}` };

/**
 * Sumsub rejected the client (redirected here by SumsubVerification): for good ('rejected') or asking for new documents
 * ('resubmit'); `user.verificationStatus` tells the two apart. Add the follow-up for rejected clients here.
 */
export default async function FailedPage() {
  const user = await requireOutcome('rejected', 'resubmit');
  return (
    <VerificationResult user={user} status="rejected">
      <div className="result-next">
        <h3>What you can do</h3>
        <p>Our team will contact you by email at {user.email} about the next steps.</p>
        {BRAND.supportEmail && (
          <p>
            Questions? Write to <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
        )}
      </div>
    </VerificationResult>
  );
}
