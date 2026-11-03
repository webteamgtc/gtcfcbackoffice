'use client';

import { useActionState, useRef, useState } from 'react';
import { uploadDocument } from '@/app/actions/documents';
import { UploadIcon } from './icons';

const DOC_TYPES = [
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'ID_CARD', label: 'National ID card' },
  { value: 'DRIVERS', label: "Driver's license" },
  { value: 'PROOF_OF_ADDRESS', label: 'Proof of address' }
];

export default function DocumentUpload() {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const [fileName, setFileName] = useState('');
  const formRef = useRef(null);

  // clear the picked file after a successful upload
  if (state?.success && fileName && !pending) {
    setFileName('');
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} action={action} className="upload-form">
      <div className="field">
        <label htmlFor="docType" className="label">Document type <span className="req">*</span></label>
        <div className="control">
          <select id="docType" name="docType" defaultValue="" required>
            <option value="" disabled>Select document type</option>
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <label className="dropzone">
        <input type="file" name="document" accept=".pdf,.jpg,.jpeg,.png" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
        <UploadIcon />
        <span className="dropzone-title">{fileName || 'Click to choose a file'}</span>
        <span className="hint">PDF, JPG or PNG, up to 10MB</span>
      </label>

      {state?.error && <p className="msg error">{state.error}</p>}
      {state?.success && <p className="msg success">{state.success}</p>}

      <button type="submit" className="btn" disabled={pending}>{pending ? 'Uploading…' : 'Upload document'}</button>
    </form>
  );
}
