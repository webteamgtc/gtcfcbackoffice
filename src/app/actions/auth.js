'use server';

import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { createSession, deleteSession } from '@/lib/session';

function passwordMatches(input, stored) {
  if (typeof stored !== 'string') return false;
  // bcrypt hashes start with $2a$ / $2b$ / $2y$
  if (/^\$2[aby]\$/.test(stored)) return bcrypt.compare(input, stored);
  // fallback for plain-text passwords already stored in user_record
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
    const db = await getDb();
    user = await db.collection('user_record').findOne({
      $or: [{ email: identifier.toLowerCase() }, { email: identifier }, { username: identifier }]
    });
  } catch (err) {
    console.error('Login DB error:', err);
    return { error: 'Could not reach the database. Please try again.', email: identifier };
  }

  if (!user || !(await passwordMatches(password, user.password))) {
    return { error: 'Invalid email or password.', email: identifier };
  }

  await createSession({ id: String(user._id), name: user.name ?? user.username ?? user.email });
  redirect('/');
}

export async function logout() {
  await deleteSession();
  redirect('/login');
}
