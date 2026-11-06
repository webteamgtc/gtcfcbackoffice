'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { deleteObject, documentKey, putObject } from '@/lib/storage';
import { getSession } from '@/lib/session';

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
    // the file goes to OSS (private object), the row in client_documents keeps its key;
    // review_status follows the Sumsub review (src/lib/verification.js)
    const key = documentKey(session.userId, file.type);
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    try {
      await query(
        'INSERT INTO client_documents (application_id, doc_type, filename, content_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?)',
        [session.userId, docType, file.name.slice(0, 255), file.type, file.size, key]
      );
    } catch (err) {
      await deleteObject(key).catch(() => {}); // no orphan file without a row
      throw err;
    }
  } catch (err) {
    console.error('Document upload error:', err);
    return { error: 'Upload failed. Please try again.' };
  }

  revalidatePath('/');
  return { success: `${file.name} uploaded.` };
}
