'use server';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket } from 'mongodb';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { getSession } from '@/lib/session';
import { DOCUMENTS_BUCKET } from '@/lib/user';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const DOC_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS', 'RESIDENCE_PERMIT', 'PROOF_OF_ADDRESS']; // Sumsub idDocType values

export async function uploadDocument(state, formData) {
  const session = await getSession();
  if (!session?.userId) return { error: 'Your session has expired. Please log in again.' };

  const file = formData.get('document');
  const docType = String(formData.get('docType') ?? '');

  if (!DOC_TYPES.includes(docType)) return { error: 'Please choose a document type.' };
  if (!file || typeof file === 'string' || file.size === 0) return { error: 'Please choose a file to upload.' };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: 'Only PDF, JPG or PNG files are allowed.' };
  if (file.size > MAX_BYTES) return { error: 'File must be 10MB or smaller.' };

  try {
    const bucket = new GridFSBucket(await getDb(), { bucketName: DOCUMENTS_BUCKET });
    const upload = bucket.openUploadStream(file.name, {
      // sumsubStatus moves past 'pending' once the Sumsub integration sends the file
      metadata: { userId: session.userId, docType, contentType: file.type, sumsubStatus: 'pending' }
    });
    await pipeline(Readable.fromWeb(file.stream()), upload);
  } catch (err) {
    console.error('Document upload error:', err);
    return { error: 'Upload failed. Please try again.' };
  }

  revalidatePath('/');
  return { success: `${file.name} uploaded.` };
}
