'use server';

import { getCurrentUser } from '@/lib/user';
import { openAccount } from '@/lib/accountOpening';

/**
 * Opens the signed-in client's MAX account (src/app/components/AccountOpening.jsx on /success). Only for a client Sumsub
 * approved; safe to call repeatedly (the account is opened once, see src/lib/accountOpening.js).
 *   → { status: 'done' | 'processing' | 'failed' | 'blocked' } | { status: 'session' }
 */
export async function openMyAccount() {
  const user = await getCurrentUser();
  if (!user) return { status: 'session' };
  if (user.verificationStatus !== 'approved') return { status: 'blocked' };
  try {
    return await openAccount(user.id);
  } catch (err) {
    console.error('[max] open account:', err);
    return { status: 'failed' };
  }
}
