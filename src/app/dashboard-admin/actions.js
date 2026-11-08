'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkAdminLogin, createAdminSession, deleteAdminSession, getAdmin } from '@/lib/admin';
import { getEncrypted } from '@/lib/adminData';
import { ADMIN_HOME, ADMIN_LOGIN } from '@/lib/adminRoutes';
import { decryptField } from '@/lib/fieldCrypto';

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
