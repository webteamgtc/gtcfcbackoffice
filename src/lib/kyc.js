// Client-side safe helpers that turn the profile + uploaded documents into the verification journey shown
// on the dashboard. Pure functions: no database access, so client components can use them too.

export const DOC_LABELS = { PASSPORT: 'Passport', ID_CARD: 'National ID card', DRIVERS: "Driver's license", RESIDENCE_PERMIT: 'Residence permit', PROOF_OF_ADDRESS: 'Proof of address' };

/** What the client has to provide. `types` are the Sumsub idDocType values accepted for it. */
export const REQUIREMENTS = [
  {
    key: 'identity',
    title: 'Identity document',
    short: 'ID document',
    noun: 'ID document',
    types: ['PASSPORT', 'ID_CARD', 'DRIVERS', 'RESIDENCE_PERMIT'],
    hint: 'Passport, national ID card or driver’s license. All four corners visible, text readable, not expired.'
  },
  {
    key: 'address',
    title: 'Proof of address',
    short: 'Proof of address',
    noun: 'proof of address',
    types: ['PROOF_OF_ADDRESS'],
    hint: 'A recent utility bill or bank statement showing your name and home address.'
  }
];

export const STATUS = {
  not_started: { label: 'Not uploaded', tone: 'neutral' },
  pending: { label: 'Under review', tone: 'warn' },
  approved: { label: 'Verified', tone: 'ok' },
  rejected: { label: 'Not accepted', tone: 'bad' },
  action: { label: 'Action needed', tone: 'bad' }
};

/** Status of one requirement = status of its most recent upload (documents arrive newest first). */
export function requirementState(req, documents) {
  const latest = documents.find((d) => req.types.includes(d.docType));
  return { ...req, status: latest?.sumsubStatus ?? 'not_started', latest };
}

// Sumsub's decision (user.verificationStatus, src/lib/user.js) → the status of both requirements
const FROM_SUMSUB = { approved: 'approved', pending: 'pending', rejected: 'rejected', resubmit: 'rejected' };

/**
 * The whole journey: per-requirement state, steps for a tracker, overall progress and the next action.
 * The Sumsub verification (/apply) decides when it has started; before that, the dashboard's own uploads.
 * `next.href` / `next.action`: where the client continues (the verification, or the outcome page).
 */
export function journey(user, documents) {
  const sumsub = FROM_SUMSUB[user.verificationStatus];
  const reqs = REQUIREMENTS.map((r) => {
    const own = requirementState(r, documents);
    return sumsub ? { ...own, status: sumsub } : own;
  });
  const uploaded = reqs.filter((r) => r.status !== 'not_started').length;
  const approved = reqs.filter((r) => r.status === 'approved').length;
  const verified = approved === reqs.length;
  const todo = reqs.find((r) => r.status === 'rejected') ?? reqs.find((r) => r.status === 'not_started');

  const steps = [
    { key: 'account', title: 'Account created', state: 'done' },
    ...reqs.map((r) => ({
      key: r.key,
      title: r.short,
      state:
        r.status === 'approved' ? 'done' : r.status === 'pending' ? 'waiting' : r.status === 'rejected' ? 'action' : todo?.key === r.key ? 'current' : 'todo'
    })),
    { key: 'review', title: 'Verified', state: verified ? 'done' : !todo ? 'waiting' : 'todo' }
  ];
  // progress: account 1, each document 1 when verified or ½ while under review, final step 1
  const score = 1 + reqs.reduce((n, r) => n + (r.status === 'approved' ? 1 : r.status === 'pending' ? 0.5 : 0), 0) + (verified ? 1 : 0);

  let next;
  if (verified)
    next = { tone: 'ok', title: 'You’re verified', text: 'Your identity and address are confirmed.', href: '/success', action: 'View your account' };
  else if (user.verificationStatus === 'rejected')
    next = { tone: 'bad', title: 'We could not verify your identity', text: 'Our team will contact you by email about the next steps.', href: '/failed', action: 'See details' };
  else if (user.verificationStatus === 'resubmit')
    next = { tone: 'bad', title: 'Some documents need to be uploaded again', text: 'Please follow the instructions in the verification to upload them again.', href: '/apply', action: 'Continue verification' };
  else if (sumsub === 'pending')
    next = { tone: 'warn', title: 'We’re checking your documents', text: 'You don’t need to do anything right now. This usually takes less than a minute.', href: '/apply', action: 'View verification' };
  else if (!documents.length)
    next = { tone: 'brand', title: 'Verify your identity', text: 'Photograph your identity document, add your proof of address and take a quick selfie. It takes about 3 minutes.', href: '/apply', action: 'Start verification' };
  else if (todo?.status === 'rejected')
    next = { tone: 'bad', title: `Upload a new ${todo.noun}`, text: `Your last ${todo.noun} could not be accepted. ${todo.hint}`, req: todo };
  else if (todo) next = { tone: 'brand', title: `Upload your ${todo.noun}`, text: todo.hint, req: todo };
  else
    next = {
      tone: 'warn',
      title: 'We’re reviewing your documents',
      text: 'You don’t need to do anything right now. This page updates as soon as the review is complete.'
    };

  // one status for the whole journey, and a short headline for banners
  const overall = verified ? 'approved' : reqs.some((r) => r.status === 'rejected') ? 'rejected' : todo ? 'not_started' : 'pending';
  const headline = {
    approved: 'Verification complete',
    rejected: 'Action needed on one document',
    not_started: `${uploaded} of ${reqs.length} documents uploaded`,
    pending: 'Your documents are under review'
  }[overall];

  return { reqs, steps, next, uploaded, approved, verified, overall, headline, progress: Math.round((score / steps.length) * 100) };
}

export const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
export const formatDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
