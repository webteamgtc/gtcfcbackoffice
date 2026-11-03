'use client';

/**
 * Upload one KYC document through the `uploadDocument` server action (fields `docType` + `document`, unchanged).
 * `types` limits the document types offered (e.g. only proof of address); with one type the picker is hidden.
 * The drop area accepts drag and drop or a click, shows the picked file, and resets after a successful upload.
 */
import { useActionState, useEffect, useRef, useState } from 'react';
import { uploadDocument } from '@/app/actions/documents';
import { DOC_LABELS, formatSize } from '@/lib/kyc';
import { CheckIcon, FileIcon, UploadIcon, XIcon } from './icons';

const ALL_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS', 'PROOF_OF_ADDRESS'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png';

export default function DocumentUpload({ types = ALL_TYPES, id = 'upload', submitLabel = 'Upload document' }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState(types.length === 1 ? types[0] : '');
  const [dragging, setDragging] = useState(false);
  const formRef = useRef(null);
  const inputRef = useRef(null);

  // after a successful upload: clear the form once (keyed on the result object, so a newly picked file is kept)
  useEffect(() => {
    if (!state?.success) return;
    formRef.current?.reset();
    setFile(null);
    if (types.length > 1) setDocType('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pick = (f) => setFile(f ?? null);
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    inputRef.current.files = dt.files; // the form submits the dropped file like a picked one
    pick(f);
  };
  const clear = () => {
    if (inputRef.current) inputRef.current.value = '';
    pick(null);
  };

  return (
    <form ref={formRef} action={action} className="up">
      {types.length > 1 ? (
        <fieldset className="up-types">
          <legend className="label">
            Document type <span className="required">*</span>
          </legend>
          <div className="chips">
            {types.map((t) => (
              <label key={t} className={docType === t ? 'chip on' : 'chip'}>
                <input type="radio" name="docType" value={t} checked={docType === t} onChange={() => setDocType(t)} required />
                {DOC_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="docType" value={types[0]} />
      )}

      <label
        htmlFor={`${id}-file`}
        className={['drop', dragging && 'is-drag', file && 'has-file'].filter(Boolean).join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input ref={inputRef} id={`${id}-file`} type="file" name="document" accept={ACCEPT} required onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <span className="drop-file">
            <span className="drop-file-icon">
              <FileIcon />
            </span>
            <span className="drop-file-text">
              <strong>{file.name}</strong>
              <small>{formatSize(file.size)}</small>
            </span>
          </span>
        ) : (
          <>
            <span className="drop-icon">
              <UploadIcon />
            </span>
            <span className="drop-title">
              <strong>Drag your file here</strong> or <u>browse</u>
            </span>
            <span className="hint">PDF, JPG or PNG · up to 10 MB</span>
          </>
        )}
      </label>
      {file && (
        <button type="button" className="link-btn" onClick={clear}>
          <XIcon /> Choose a different file
        </button>
      )}

      {state?.error && (
        <p className="note bad" role="alert">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="note ok" role="status">
          <CheckIcon /> {state.success} We’ll review it shortly.
        </p>
      )}

      <button type="submit" className="btn" disabled={pending || !file || !docType}>
        {pending ? 'Uploading…' : submitLabel}
      </button>
    </form>
  );
}
