import VerificationResult, { requireOutcome } from '@/app/components/VerificationResult';
import AccountOpening from '@/app/components/AccountOpening';
import { accountStatus } from '@/lib/accountOpening';
import { BRAND } from '@/lib/brand';
import { cat5Configured } from '@/lib/cat5';
import { demoMode } from '@/lib/demo';
import '@/app/apply/apply.css';

export const metadata = { title: `Verified | ${BRAND.name}` };

/**
 * Sumsub approved the client (redirected here by SumsubVerification). The account is then opened in MAX
 * (AccountOpening → src/lib/accountOpening.js), which e-mails the client their login details.
 */
export default async function SuccessPage() {
  const user = await requireOutcome('approved');
  const account = await accountStatus(user.id);
  return (
    <VerificationResult user={user} status="approved">
      {demoMode() && (
        <p className="note warn-note" role="note">
          Demo mode: identity verification was skipped and dummy KYC data is used{cat5Configured() ? '' : '; MAX is simulated (request in the server console)'}.
        </p>
      )}
      <div className="result-next">
        <h3>Your account</h3>
        <AccountOpening initial={account?.status ?? null} email={user.email} />
      </div>
    </VerificationResult>
  );
}
