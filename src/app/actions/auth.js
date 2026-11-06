'use server';

import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { createSession, deleteSession } from '@/lib/session';

function passwordMatches(input, stored) {
  if (typeof stored !== 'string') return false;
  // bcrypt hashes start with $2a$ / $2b$ / $2y$
  if (/^\$2[aby]\$/.test(stored)) return bcrypt.compare(input, stored);
  // fallback for plain-text passwords in imported records
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function login(state, formData) {
  const identifier = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!identifier || !password) {
    return { error: 'Please enter your email and password.', email: identifier };
  }

  let user;
  try {
    user = await queryOne('SELECT id, firstName, lastName, email, passwordHash FROM client_applications WHERE email = ?', [identifier.toLowerCase()]);
  } catch (err) {
    console.error('Login DB error:', err);
    return { error: 'Could not reach the database. Please try again.', email: identifier };
  }

  if (!user || !(await passwordMatches(password, user.passwordHash))) {
    return { error: 'Invalid email or password.', email: identifier };
  }

  await createSession({ id: String(user.id), name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email });
  redirect('/');
}

export async function logout() {
  await deleteSession();
  redirect('/login');
}
