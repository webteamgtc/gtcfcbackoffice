import VerificationResult, { requireOutcome } from '@/app/components/VerificationResult';
import { BRAND } from '@/lib/brand';
import '@/app/apply/apply.css';

export const metadata = { title: `Verified | ${BRAND.name}` };

/** Sumsub approved the client (redirected here by SumsubVerification). Add the next steps for verified clients here. */
export default async function SuccessPage() {
  const user = await requireOutcome('approved');
  return (
    <VerificationResult user={user} status="approved">
      <div className="result-next">
        <h3>What happens next</h3>
        <p>Our team will review your application and contact you by email at {user.email} within 1–2 business days.</p>
      </div>
    </VerificationResult>
  );
}
