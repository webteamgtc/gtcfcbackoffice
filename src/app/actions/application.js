'use server';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { headers } from 'next/headers';
import { GridFSBucket, ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { createSession } from '@/lib/session';
import { DOCUMENTS_BUCKET } from '@/lib/user';
import { FILE_FIELDS, firstStepWithError, needsBackSide, readApplication, validateAll } from '@/lib/application';

/**
 * Client application, the five-step KYC journey (src/app/components/LiveApplicationForm.jsx, fields in src/lib/application.js):
 *   uploadApplicationFile → steps 2 and 3: stores one picked file (ID front / back, proof of address) in GridFS under the
 *                           form's draft id, before the client exists; picking again replaces it. → { ok, id } / { error }
 *   submitApplication     → last step: validates every step and that the uploaded files are there, saves the client to
 *                           `user_record` (answers under `kyc`), links the files to the client, and signs the client in
 *                           (session cookie) for the Sumsub verification that follows.
 *                           → { ok, reference } or { step (0-based), errors } / { error }
 */

// kept under Vercel's 4.5MB request limit; the form shrinks large photos before sending them
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const DRAFT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const files = (db) => db.collection(`${DOCUMENTS_BUCKET}.files`);

export async function uploadApplicationFile(formData) {
  const draftId = String(formData.get('draftId') ?? '');
  const field = String(formData.get('field') ?? '');
  const file = formData.get('file');

  if (!DRAFT_RE.test(draftId) || !FILE_FIELDS[field]) return { error: 'Please reload the page and try again.' };
  if (!file || typeof file === 'string' || file.size === 0) return { error: 'Please choose a file.' };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: 'Only PDF, JPG or PNG files are allowed.' };
  if (file.size > MAX_BYTES) return { error: 'The file is too large. Please use a file of 4 MB or less.' };

  try {
    const db = await getDb();
    const bucket = new GridFSBucket(db, { bucketName: DOCUMENTS_BUCKET });
    // replace an earlier upload for the same field of this (not yet submitted) application
    const old = await files(db).find({ 'metadata.draftId': draftId, 'metadata.field': field, 'metadata.userId': { $exists: false } }, { projection: { _id: 1 } }).toArray();
    for (const f of old) await bucket.delete(f._id).catch(() => {});

    const upload = bucket.openUploadStream(file.name, {
      metadata: { draftId, field, contentType: file.type, source: 'web-application', sumsubStatus: 'pending', uploadedAt: new Date() }
    });
    await pipeline(Readable.fromWeb(file.stream()), upload);
    return { ok: true, id: String(upload.id) };
  } catch (err) {
    console.error('[application] upload:', err);
    return { error: 'Upload failed. Please try again.' };
  }
}

export async function submitApplication(input) {
  const v = readApplication(input);
  const errors = validateAll(v);
  if (Object.keys(errors).length) return { step: firstStepWithError(errors), errors };
  if (!DRAFT_RE.test(v.draftId)) return { error: 'Please reload the page and try again.' };

  let db;
  let insertedId;
  const now = new Date();
  const wanted = Object.keys(FILE_FIELDS).filter((k) => k !== 'idBack' || needsBackSide(v.idType));
  try {
    db = await getDb();

    // every uploaded file must still be there, belong to this draft and not to another client
    const missing = {};
    for (const k of wanted) {
      const ok =
        ObjectId.isValid(v[k]) &&
        (await files(db).findOne({ _id: new ObjectId(v[k]), 'metadata.draftId': v.draftId, 'metadata.field': k, 'metadata.userId': { $exists: false } }, { projection: { _id: 1 } }));
      if (!ok) missing[k] = `Please upload the ${FILE_FIELDS[k].label} again.`;
    }
    if (Object.keys(missing).length) return { step: firstStepWithError(missing), errors: missing };

    const h = await headers();
    ({ insertedId } = await db.collection('user_record').insertOne({
      name: `${v.firstName} ${v.lastName}`,
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth,
      country: v.country,
      nationality: v.nationality,
      partnerCode: v.partnerCode,
      kyc: {
        identity: {
          documentType: v.idType,
          firstName: v.idFirstName,
          lastName: v.idLastName,
          idNumber: v.idNumber,
          nationality: v.nationality,
          frontFileId: new ObjectId(v.idFront),
          backFileId: wanted.includes('idBack') ? new ObjectId(v.idBack) : null
        },
        address: { country: v.poaCountry, postalCode: v.postalCode, address: v.address, proofDate: v.proofDate || null, fileId: new ObjectId(v.poaFile) },
        questionnaire: {
          education: v.education,
          employment: v.employment,
          industry: v.industry === 'Other' ? `Other: ${v.industryOther}` : v.industry,
          occupation: v.occupation === 'Other' ? `Other: ${v.occupationOther}` : v.occupation,
          employer: v.employer,
          previousEmployment: v.previousEmployment,
          experienceYears: v.experienceYears,
          annualIncome: v.income,
          sourceOfFunds: v.sourceOfFunds,
          investmentExperience: v.investmentExperience,
          marketExperience: v.marketExperience,
          usCitizen: v.usCitizen === 'Yes',
          tin: v.tin,
          pepDeclarationAccepted: true
        },
        agreements: {
          clientAgreement1: { accepted: true, acceptedAt: now },
          clientAgreement2: { accepted: true, acceptedAt: now }
        },
        status: 'submitted',
        submittedAt: now
      },
      applicationStatus: 'submitted',
      source: 'web-application',
      ip: (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim(),
      userAgent: (h.get('user-agent') ?? '').slice(0, 300),
      createdAt: now
    }));

    // the files now belong to the client (shown with their documents; docType as Sumsub names it)
    const userId = String(insertedId);
    for (const k of wanted) {
      const { docType, side } = FILE_FIELDS[k];
      await files(db).updateOne(
        { _id: new ObjectId(v[k]) },
        { $set: { 'metadata.userId': userId, 'metadata.docType': docType ?? v.idType, ...(side ? { 'metadata.side': side } : {}) }, $unset: { 'metadata.draftId': '' } }
      );
    }
  } catch (err) {
    console.error('[application] submit:', err);
    return { error: 'We could not save your application. Please try again.' };
  }
  const userId = String(insertedId);

  // signed in from here on: the identity verification that follows (actions/verification.js) is tied to this client
  await createSession({ id: userId, name: `${v.firstName} ${v.lastName}` });

  const reference = userId.slice(-8).toUpperCase();
  await db.collection('user_record').updateOne({ _id: insertedId }, { $set: { applicationReference: reference } }).catch(() => {});

  return { ok: true, reference };
}
