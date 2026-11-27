'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { checkAdminLogin, createAdminSession, deleteAdminSession, getAdmin } from '@/lib/admin';
import { getEncrypted } from '@/lib/adminData';
import { ADMIN_HOME, ADMIN_LOGIN } from '@/lib/adminRoutes';
import { decryptField } from '@/lib/fieldCrypto';
import { query } from '@/lib/db';
import { openAccount } from '@/lib/accountOpening';
import { refreshVerification } from '@/lib/verification';
import { demoMode } from '@/lib/demo';

const clientIp = async () => {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim();
};

export async function adminLogin(state, formData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Please enter your email and password.', email };

  const res = await checkAdminLogin(email, password, await clientIp());
  if (!res.ok) {
    const error = {
      not_configured: 'Administrator access is not set up on this server yet.',
      locked: 'Too many attempts. Please wait 15 minutes and try again.',
      invalid: 'Invalid email or password.'
    }[res.reason];
    console.warn(`[admin] failed sign-in for ${email} (${res.reason})`);
    return { error, email };
  }
  await createAdminSession(res.email);
  console.info(`[admin-audit] ${res.email} signed in`);
  redirect(ADMIN_HOME);
}

export async function adminLogout() {
  await deleteAdminSession();
  redirect(ADMIN_LOGIN);
}

/**
 * Shows one protected value (ID number or tax number) of an application. Only for a signed-in administrator, one value at a
 * time, and every reveal is written to the server log with who and which application.
 */
export async function revealSensitive(applicationId, field) {
  const admin = await getAdmin();
  if (!admin) return { error: 'Please sign in again.' };
  if (!/^\d+$/.test(String(applicationId)) || !['idNumber', 'tin'].includes(field)) return { error: 'Not available.' };
  try {
    const row = await getEncrypted(applicationId);
    const cipher = row?.[field === 'idNumber' ? 'idNumberEncrypted' : 'tinEncrypted'];
    if (!cipher) return { error: 'Nothing stored.' };
    const value = decryptField(cipher);
    console.info(`[admin-audit] ${admin} revealed ${field} of application ${applicationId}`);
    return { value };
  } catch (err) {
    console.error('[admin] reveal:', err.message);
    return { error: 'Could not read this value.' };
  }
}

/**
 * Opens the client's account in MAX from the back office (src/lib/accountOpening.js: uploads, onboarding, then the e-mail
 * with the client's login details), or tries again after a failure. Only for a client Shufti Pro accepted. A failed or
 * blocked attempt is started afresh (the tries count again from 0); an account already open is left alone.
 * → { status: 'done' | 'processing' | 'failed' | 'blocked', message } | { error }
 */
export async function openMaxAccount(applicationId) {
  const admin = await getAdmin();
  if (!admin) return { error: 'Please sign in again.' };
  if (!/^\d+$/.test(String(applicationId))) return { error: 'Not available.' };
  try {
    const verification = demoMode() ? 'approved' : await refreshVerification(applicationId);
    if (verification !== 'approved') return { error: 'The client is not verified by Shufti Pro yet.' };
    await query("UPDATE max_onboarding SET status = 'failed', attempts = 0 WHERE application_id = ? AND status IN ('failed', 'blocked')", [applicationId]);
    console.info(`[admin-audit] ${admin} opened the MAX account of application ${applicationId}`);
    const { status } = await openAccount(applicationId);
    revalidatePath(`${ADMIN_HOME}/applications/${applicationId}`);
    return { status };
  } catch (err) {
    console.error('[admin] open MAX account:', err.message);
    return { error: 'Could not open the account. Please try again.' };
  }
}
