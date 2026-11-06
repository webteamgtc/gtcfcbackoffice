'use client';

/**
 * Client application: the personal KYC journey from "Current KYC Journey in MAX CRM" (public/…-form.docx), five steps,
 * with exactly the fields of the document:
 *   1. Personal Information: surname, given name, date of birth, country of residence, nationality.
 *   2. Identity Information: nationality, document type, front and back photo, name and number as on the document.
 *   3. Proof of Address: utility bill / bank statement file, country, postal code, address, proof date.
 *   Files upload as soon as they are picked (uploadApplicationFile; large photos are shrunk first) and are linked to the
 *   client on submit.
 *   4. Questionnaire, shown in three short parts (work & education · income & funds · experience & declarations).
 *   5. Client Agreement: the two agreements to sign. Submit saves everything (src/app/actions/application.js),
 *      and shows the success panel with the Sumsub verification (SumsubVerification.jsx), as before.
 * Fields, options and rules live in src/lib/application.js. Nothing is saved until the last step.
 * Partner code is read from the URL (?code, ?ref, ?partner_id, ?partner_code, ?ib); ?code / ?ref lock it.
 *
 * Layout "Guided journey": a navy panel follows the client through the steps (progress ring, minutes left, the
 * questionnaire parts), the form card sits on the right; on phones the panel becomes a header with a progress bar.
 * Styles: src/app/apply/apply.css.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Logo from './Logo';
import { submitApplication, uploadApplicationFile } from '@/app/actions/application';
import {
  AGREEMENT_TEXT, EMPTY_APPLICATION, ID_TYPES, OPTIONS, PEP_TEXT, STEPS, STEP_FIELDS, firstStepWithError, needsBackSide,
  validateAll, validateStep
} from '@/lib/application';
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/countries';
import { DOC_LABELS } from '@/lib/kyc';
import { BRAND } from '@/lib/brand';
import SumsubVerification from './SumsubVerification';
import DatePicker from './DatePicker';
import {
  AlertIcon, ArrowRightIcon, BriefcaseIcon, ChartIcon, CheckIcon, ClockIcon, FileIcon, GlobeIcon, HomeIcon, IdCardIcon, LockIcon, PenIcon,
  ShieldIcon, SparkIcon, UploadIcon, UserIcon, WalletIcon, XIcon
} from './icons';

const ACCEPT = '.pdf,.jpg,.jpeg,.png';
const MAX_BYTES = 4 * 1024 * 1024; // per file, after shrinking (server: actions/application.js)
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const asOptions = (list) => list.map((o) => ({ value: o, label: o }));
const today = () => new Date().toISOString().slice(0, 10);

const STEP_ICONS = [UserIcon, IdCardIcon, HomeIcon, BriefcaseIcon, PenIcon];

/**
 * What the client sees, one screen at a time. The questionnaire (step 4) is split into three parts; each part checks
 * only its own fields, the server still validates the whole step.
 */
const SCREENS = [
  { step: 0, Icon: UserIcon, minutes: 1, title: 'Personal information', text: 'Use your name exactly as it appears on your identity document.', cheer: 'Let’s get started' },
  { step: 1, Icon: IdCardIcon, minutes: 2, title: 'Identity information', text: 'Upload clear photos of your document and enter the details exactly as they appear on it.', cheer: 'Nice start' },
  { step: 2, Icon: HomeIcon, minutes: 2, title: 'Proof of address', text: 'Upload a recent utility bill or bank statement and enter the address shown on it.', cheer: 'Almost halfway' },
  {
    step: 3, part: 0, Icon: BriefcaseIcon, minutes: 1, title: 'Work and education', text: 'A few questions about your background, as required by our compliance obligations.', cheer: 'Halfway there',
    fields: ['education', 'employment', 'industry', 'industryOther', 'occupation', 'occupationOther', 'employer', 'previousEmployment']
  },
  { step: 3, part: 1, Icon: WalletIcon, minutes: 1, title: 'Income and funds', text: 'Choose the options that describe you best.', cheer: 'Keep going', fields: ['experienceYears', 'income', 'sourceOfFunds'] },
  {
    step: 3, part: 2, Icon: ChartIcon, minutes: 1, title: 'Experience and declarations', text: 'Your investment background and two short declarations.', cheer: 'Nearly done',
    fields: ['investmentExperience', 'marketExperience', 'usCitizen', 'tin', 'pep']
  },
  { step: 4, Icon: PenIcon, minutes: 1, title: 'Client agreement', text: 'Please read the documents below and confirm to sign them electronically.', cheer: 'Almost there' }
];
const partsOf = (step) => SCREENS.filter((s) => s.step === step).length;
const firstScreenOf = (step) => SCREENS.findIndex((s) => s.step === step);
const fieldsOf = (screen) => screen.fields ?? STEP_FIELDS[STEPS[screen.step].key];

/** Photos over 1.5 MB are redrawn at most 2400 px wide as JPEG, so they upload fast and fit the size limit. */
async function shrink(file) {
  if (!/^image\/(jpeg|png)$/.test(file.type) || file.size < 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/** A random UUID (crypto.randomUUID needs a secure context; the fallback builds one from random bytes). */
function newDraftId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const formatSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function readPartner() {
  const q = new URLSearchParams(window.location.search);
  const partner = q.get('code') || q.get('ref') || q.get('partner_id') || q.get('partner_code') || q.get('ib') || '';
  return { partner, locked: Boolean(q.get('code') || q.get('ref')) };
}

function Field({ id, label, required, optional, error, hint, wide, children }) {
  return (
    <div className={`field${wide ? ' apply-wide' : ''}`}>
      <label htmlFor={id} className="label">
        {label} {required && <span className="required">*</span>}
        {optional && <span className="optional">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          <AlertIcon /> {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

/** Ring showing the share of the journey done. */
function ProgressRing({ value, size = 88 }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <span className="ap-ring" style={{ width: size, height: size }} role="img" aria-label={`${value}% complete`}>
      <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="ap-ring-track" />
        <circle cx="36" cy="36" r={r} className="ap-ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <strong>{value}%</strong>
    </span>
  );
}

/** Coloured pieces that fall once over the success card (decorative). */
function Confetti() {
  return (
    <div className="ap-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 7) * 0.12}s`, '--r': `${(i * 53) % 360}deg` }} />
      ))}
    </div>
  );
}

export default function LiveApplicationForm() {
  const [screen, setScreen] = useState(0);
  const [dir, setDir] = useState('fwd');
  const [shake, setShake] = useState(0);
  const [values, setValues] = useState({ ...EMPTY_APPLICATION, country: DEFAULT_COUNTRY });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [uploads, setUploads] = useState({}); // field → { status: 'uploading' | 'done' | 'error', name, size, preview, error }
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(null);
  const topRef = useRef(null);

  // partner code from the URL and the draft id for the uploads (after mount, so the page can stay static)
  useEffect(() => {
    const { partner } = readPartner();
    setValues((v) => ({ ...v, partnerCode: partner || v.partnerCode, draftId: v.draftId || newDraftId() }));
  }, []);

  const clientErrors = useMemo(() => validateAll(values), [values]);
  const err = (k) => serverErrors[k] ?? (touched[k] ? clientErrors[k] : undefined);
  const ok = (k) => touched[k] && !err(k) && Boolean(values[k]);

  const clearServer = (k) => setServerErrors(({ [k]: _, ...rest }) => rest);
  const setValue = (k, value) => {
    setValues((v) => ({ ...v, [k]: value }));
    clearServer(k);
  };
  const set = (k) => (e) => setValue(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const go = (i) => {
    setAlert(null);
    setDir(i >= screen ? 'fwd' : 'back');
    setScreen(i);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const screens = SCREENS;
  const steps = STEPS;
  const current = screens[screen];
  const stepIndex = current.step;
  const last = screen === screens.length - 1;
  const cheer = last ? 'Last step' : current.cheer;
  const progress = done ? 100 : Math.round((screen / screens.length) * 100);
  const minutesLeft = screens.slice(screen).reduce((n, s) => n + s.minutes, 0);

  /* ---------------------------------------------------------------- field renderers (plain functions, not components) */

  const control = (k, icon, children, extra = '', withOk = true) => (
    <div className={`control${extra}${err(k) ? ' is-bad' : ''}${withOk && ok(k) ? ' is-ok' : ''}`}>
      {icon && <span className="icon">{icon}</span>}
      {children}
      {withOk && (
        <span className="ok-mark" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </div>
  );

  const textField = (k, label, { icon, required = true, optional, hint, wide, ...props } = {}) => (
    <Field id={`ap-${k}`} label={label} required={required && !optional} optional={optional} error={err(k)} hint={hint} wide={wide}>
      {control(k, icon, <input id={`ap-${k}`} value={values[k]} onChange={set(k)} onBlur={blur(k)} aria-invalid={Boolean(err(k))} {...props} />)}
    </Field>
  );

  const dateField = (k, label, { optional, hint, initialView, max = today() } = {}) => (
    <Field id={`ap-${k}`} label={label} required={!optional} optional={optional} error={err(k)} hint={hint}>
      {control(
        k,
        null,
        <DatePicker id={`ap-${k}`} value={values[k]} onChange={(v) => setValue(k, v)} onBlur={blur(k)} max={max} initialView={initialView} invalid={Boolean(err(k))} />,
        ' date',
        false
      )}
    </Field>
  );

  const selectField = (k, label, options, { icon, wide, placeholder = 'Please select' } = {}) => (
    <Field id={`ap-${k}`} label={label} required error={err(k)} wide={wide}>
      {control(
        k,
        icon,
        <select id={`ap-${k}`} value={values[k]} onChange={set(k)} onBlur={blur(k)} aria-invalid={Boolean(err(k))} className={values[k] ? '' : 'is-empty'}>
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
        ' select',
        false
      )}
    </Field>
  );

  const choiceField = (k, label, options, { wide = true, cols } = {}) => (
    <fieldset className={`choice-field${wide ? ' apply-wide' : ''}`}>
      <legend className="label">
        {label} <span className="required">*</span>
      </legend>
      <div className={`chips${cols ? ` cols-${cols}` : ''}`}>
        {options.map((o) => (
          <label key={o.value} className={values[k] === o.value ? 'chip on' : 'chip'}>
            <input
              type="radio"
              name={k}
              value={o.value}
              checked={values[k] === o.value}
              onChange={() => {
                setValue(k, o.value);
                setTouched((t) => ({ ...t, [k]: true }));
              }}
            />
            <span className="chip-tick" aria-hidden="true">
              <CheckIcon />
            </span>
            {o.label}
          </label>
        ))}
      </div>
      {err(k) && (
        <p className="field-error" role="alert">
          <AlertIcon /> {err(k)}
        </p>
      )}
    </fieldset>
  );

  const declareField = (k, title, text, children) => (
    <div className="apply-wide">
      <label className={`declare${err(k) ? ' is-bad' : ''}${values[k] ? ' is-on' : ''}`}>
        <input type="checkbox" checked={values[k]} onChange={set(k)} onBlur={blur(k)} />
        <span className="declare-box" aria-hidden="true">
          <CheckIcon />
        </span>
        <span>
          {title && <strong>{title}</strong>}
          <span>{text}</span>
        </span>
      </label>
      {children}
      {err(k) && (
        <p className="field-error" role="alert">
          <AlertIcon /> {err(k)}
        </p>
      )}
    </div>
  );

  /** Picks, shrinks and uploads one file right away; the field holds the stored file id once it is uploaded. */
  const pickFile = async (k, picked) => {
    if (!picked) return;
    setTouched((t) => ({ ...t, [k]: true }));
    const fail = (error) => {
      setValue(k, '');
      setUploads((u) => ({ ...u, [k]: { status: 'error', name: picked.name, size: picked.size, error } }));
    };
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(picked.type)) return fail('Only PDF, JPG or PNG files are allowed.');
    const file = await shrink(picked);
    if (file.size > MAX_BYTES) return fail('This file is larger than 4 MB. Please use a smaller photo or PDF.');
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setValue(k, '');
    setUploads((u) => {
      if (u[k]?.preview) URL.revokeObjectURL(u[k].preview);
      return { ...u, [k]: { status: 'uploading', name: file.name, size: file.size, preview } };
    });
    const fd = new FormData();
    fd.append('draftId', values.draftId);
    fd.append('field', k);
    fd.append('file', file);
    let res;
    try {
      res = await uploadApplicationFile(fd);
    } catch {
      res = { error: 'Upload failed. Please check your connection and try again.' };
    }
    if (res?.ok) {
      setValue(k, res.id);
      setUploads((u) => ({ ...u, [k]: { ...u[k], status: 'done' } }));
    } else {
      setUploads((u) => ({ ...u, [k]: { ...u[k], status: 'error', error: res?.error ?? 'Upload failed. Please try again.' } }));
    }
  };
  const removeFile = (k) => {
    setValue(k, '');
    setUploads(({ [k]: old, ...rest }) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      return rest;
    });
  };

  const fileField = (k, label, { hint, required = true, wide } = {}) => {
    const u = uploads[k];
    const error = err(k) ?? (u?.status === 'error' ? u.error : undefined);
    return (
      <div className={`field file-field${wide ? ' apply-wide' : ''}`}>
        <span className="label" id={`ap-${k}-label`}>
          {label} {required && <span className="required">*</span>}
        </span>
        {u && u.status !== 'error' ? (
          <div className={`file-card is-${u.status}`}>
            <span className="file-thumb">{u.preview ? <img src={u.preview} alt="" /> : <FileIcon />}</span>
            <span className="file-text">
              <strong>{u.name}</strong>
              <small>
                {u.status === 'uploading' ? (
                  <>
                    <i className="file-spin" aria-hidden="true" /> Uploading…
                  </>
                ) : (
                  <>
                    <CheckIcon /> Uploaded · {formatSize(u.size)}
                  </>
                )}
              </small>
            </span>
            <span className="file-actions">
              <label className="file-btn" htmlFor={`ap-${k}`}>
                Replace
              </label>
              <button type="button" className="file-btn icon" onClick={() => removeFile(k)} aria-label={`Remove ${label}`} disabled={u.status === 'uploading'}>
                <XIcon />
              </button>
            </span>
            <span className="file-progress" aria-hidden="true" />
          </div>
        ) : (
          <label
            htmlFor={`ap-${k}`}
            className={`drop file-drop${error ? ' is-bad' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('is-drag');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('is-drag')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('is-drag');
              pickFile(k, e.dataTransfer.files?.[0]);
            }}
          >
            <span className="drop-icon">
              <UploadIcon />
            </span>
            <span className="drop-title">
              <strong>Drag your file here</strong> or <u>browse</u>
            </span>
            <span className="hint">{hint ?? 'JPG, PNG or PDF · up to 4 MB'}</span>
          </label>
        )}
        <input
          id={`ap-${k}`}
          className="file-input"
          type="file"
          accept={ACCEPT}
          aria-labelledby={`ap-${k}-label`}
          onChange={(e) => {
            pickFile(k, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {error && (
          <p className="field-error" role="alert">
            <AlertIcon /> {error}
          </p>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- actions */

  const next = (e) => {
    e.preventDefault();
    setAlert(null);
    const key = STEPS[stepIndex].key;
    const fields = fieldsOf(current);
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((k) => [k, true])) }));
    if (fields.some((k) => uploads[k]?.status === 'uploading')) {
      setAlert('Please wait until your files finish uploading.');
      return;
    }
    const stepErrors = validateStep(key, values);
    if (fields.some((k) => stepErrors[k])) {
      setShake((n) => n + 1);
      return;
    }

    // after step 1, the proof of address country starts as the country of residence
    if (screen === 0) setValues((v) => ({ ...v, poaCountry: v.poaCountry || v.country }));
    if (!last) return go(screen + 1);

    startTransition(async () => {
      let res;
      try {
        res = await submitApplication(values);
      } catch {
        res = { error: 'We could not send your application. Please check your connection and try again.' };
      }
      if (res?.ok) {
        setDone({ reference: res.reference });
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      setServerErrors(res?.errors ?? {});
      const back = res?.step ?? (res?.errors ? firstStepWithError(res.errors) : -1);
      if (back >= 0 && back !== stepIndex) {
        let target = firstScreenOf(back);
        // inside the questionnaire, open the part that holds the first wrong field
        const part = screens.findIndex((s) => s.step === back && s.fields?.some((k) => res.errors?.[k]));
        if (part >= 0) target = part;
        go(target);
        setAlert('Please check the highlighted fields.');
      } else if (res?.error) setAlert(res.error);
    });
  };

  /* ---------------------------------------------------------------- pieces shared by the layouts */

  const stepState = (i) => (done || i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo');

  const bar = (
    <div className="ap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Application progress">
      <span style={{ width: `${Math.max(progress, 4)}%` }} />
    </div>
  );

  const meta = (
    <p className="ap-meta">
      <span>
        Step {stepIndex + 1} of {steps.length}
        {current.part != null && ` · part ${current.part + 1} of ${partsOf(current.step)}`}
      </span>
      <span>
        <ClockIcon /> About {minutesLeft} min left
      </span>
    </p>
  );

  const head = (
    <div className="apply-head">
      <span className="ap-head-icon" key={`i-${screen}`}>
        <current.Icon />
      </span>
      <div>
        <p className="ap-cheer">
          <SparkIcon /> {cheer}
        </p>
        <h2>{current.title}</h2>
        <p>{current.text}</p>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- one screen of fields */

  const fieldsFor = () => {
    switch (screen) {
      case 0:
        return (
          <div className="apply-grid">
            {textField('lastName', 'Surname', { icon: <UserIcon />, placeholder: 'Surname', autoComplete: 'family-name' })}
            {textField('firstName', 'Given name', { icon: <UserIcon />, placeholder: 'Given name', autoComplete: 'given-name' })}
            {dateField('dateOfBirth', 'Date of birth', { initialView: `${new Date().getFullYear() - 30}-01-01` })}
            {selectField('country', 'Country of residence', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}
            {selectField('nationality', 'Nationality', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}
          </div>
        );
      case 1:
        return (
          <div className="apply-grid">
            {selectField('nationality', 'Nationality', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}
            <div className="apply-spacer" aria-hidden />
            {choiceField(
              'idType',
              'Identification document',
              ID_TYPES.map((t) => ({ value: t, label: DOC_LABELS[t] })),
              { cols: 4 }
            )}
            {fileField('idFront', 'Front side photo of document', { hint: 'All four corners visible, no glare · JPG, PNG or PDF' })}
            {needsBackSide(values.idType)
              ? fileField('idBack', 'Back side photo of document', { hint: 'All four corners visible, no glare · JPG, PNG or PDF' })
              : (
                <div className="field file-field">
                  <span className="label">Back side photo of document</span>
                  <p className="file-skip">
                    <CheckIcon /> Not needed for a passport
                  </p>
                </div>
              )}
            <p className="apply-section apply-wide">As shown on the document</p>
            {textField('idLastName', 'Surname', { icon: <UserIcon />, placeholder: 'Surname on the document' })}
            {textField('idFirstName', 'Given name', { icon: <UserIcon />, placeholder: 'Given name on the document' })}
            {textField('idNumber', 'ID number', { icon: <IdCardIcon />, placeholder: 'Document number', autoComplete: 'off' })}
          </div>
        );
      case 2:
        return (
          <div className="apply-grid">
            {fileField('poaFile', 'Utilities & bank statements', { wide: true, hint: 'A utility bill or bank statement from the last 3 months showing your name and address · JPG, PNG or PDF' })}
            {selectField('poaCountry', 'Country (region) of residence', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}
            {textField('postalCode', 'Postal code', { placeholder: 'Postal code', autoComplete: 'postal-code' })}
            <Field id="ap-address" label="Detailed address" required error={err('address')} wide>
              <textarea
                id="ap-address"
                className={`textarea${err('address') ? ' is-bad' : ''}`}
                value={values.address}
                onChange={set('address')}
                onBlur={blur('address')}
                rows={3}
                maxLength={300}
                placeholder="Apartment / building, street, area, city"
                autoComplete="street-address"
                aria-invalid={Boolean(err('address'))}
              />
              <span className="ap-count">{values.address.length} / 300</span>
            </Field>
            {dateField('proofDate', 'Proof date', { optional: true, hint: 'The date printed on the document.' })}
          </div>
        );
      case 3:
        return (
          <div className="apply-grid">
            {selectField('education', 'Educational level', asOptions(OPTIONS.education))}
            {selectField('employment', 'Employment & financial information', asOptions(OPTIONS.employment))}
            {selectField('industry', 'Industry', asOptions(OPTIONS.industry))}
            {values.industry === 'Other' && textField('industryOther', 'Please specify your industry', { placeholder: 'Your industry' })}
            {selectField('occupation', 'Occupation / job title', asOptions(OPTIONS.occupation))}
            {values.occupation === 'Other' && textField('occupationOther', 'Please specify your job title', { placeholder: 'Your job title' })}
            {textField('employer', 'Name of employer / business', { optional: true, placeholder: 'Employer or business name', autoComplete: 'organization' })}
            {textField('previousEmployment', 'Previous employment', { optional: true, placeholder: 'Previous employer or role' })}
          </div>
        );
      case 4:
        return (
          <div className="apply-grid">
            {choiceField('experienceYears', 'Years of working experience', asOptions(OPTIONS.experienceYears), { cols: 5 })}
            {choiceField('income', 'What is your estimated annual income?', asOptions(OPTIONS.income), { cols: 3 })}
            {selectField('sourceOfFunds', 'What is the source of your funds / wealth?', asOptions(OPTIONS.sourceOfFunds), { wide: true })}
          </div>
        );
      case 5:
        return (
          <div className="apply-grid">
            {choiceField('investmentExperience', 'Investment experience', asOptions(OPTIONS.investmentExperience), { cols: 4 })}
            {choiceField('marketExperience', 'Market investment experience', asOptions(OPTIONS.marketExperience), { cols: 4 })}
            {choiceField('usCitizen', 'Are you a citizen of the US?', asOptions(OPTIONS.usCitizen), { wide: false, cols: 2 })}
            {textField('tin', 'Tax Identification No. (TIN) or its equivalent', { optional: true, placeholder: 'TIN', autoComplete: 'off' })}
            {declareField('pep', 'Politically Exposed Person (PEP)', PEP_TEXT)}
          </div>
        );
      default:
        return (
          <div className="apply-agreements">
            {BRAND.agreements.map((a, i) => {
              const k = `agreement${i + 1}`;
              return (
                <Fragment key={k}>
                  {declareField(
                    k,
                    a.title,
                    AGREEMENT_TEXT,
                    a.url ? (
                      <div className="agreement-doc">
                        <iframe src={a.url} title={a.title} loading="lazy" />
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="help-link">
                          <FileIcon /> Open {a.title} in a new tab
                        </a>
                      </div>
                    ) : null
                  )}
                </Fragment>
              );
            })}
            <p className="note warn-note">
              <AlertIcon /> By submitting, you sign these documents electronically. Your signature is equivalent to a handwritten one.
            </p>
          </div>
        );
    }
  };

  const actions = (
    <div className="apply-actions">
      {screen > 0 && (
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => go(screen - 1)}>
          <span className="back-arrow">
            <ArrowRightIcon />
          </span>
          Back
        </button>
      )}
      <button type="submit" className={`btn btn-grow btn-next${last ? ' btn-gold' : ''}${pending ? ' is-busy' : ''}`} disabled={pending}>
        {pending ? (
          last ? 'Submitting your application…' : 'Checking…'
        ) : last ? (
          <>
            <PenIcon /> Sign and submit
          </>
        ) : (
          <>
            Continue: {screens[screen + 1].title} <ArrowRightIcon />
          </>
        )}
      </button>
    </div>
  );

  const form = (
    <form className="apply-form" onSubmit={next} noValidate>
      {alert && (
        <p className="alert ap-pop" role="alert">
          {alert}
        </p>
      )}
      <div key={screen} className={`ap-screen ${dir}`}>
        {head}
        <div key={`s-${shake}`} className={shake ? 'ap-shake' : undefined}>
          {fieldsFor()}
        </div>
      </div>
      {actions}
    </form>
  );

  const success = done && (
    <div className="ap-done">
      <Confetti />
      <div className="apply-success" role="status">
        <span className="apply-success-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path className="ap-draw" d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Application submitted</h2>
        <p>
          Thank you, <span className="cap">{values.firstName}</span>. We’ve received your application and documents. Please complete the identity verification below.
        </p>
        <p className="apply-ref">
          Reference <strong>{done.reference}</strong>
        </p>
      </div>
      <SumsubVerification />
    </div>
  );

  const body = success || form;
  const year = new Date().getFullYear();

  /* ---------------------------------------------------------------- layouts */

  /* ---------------------------------------------------------------- layout */

  return (
    <main className="ap">
      <aside className="ap-a-panel">
        <div className="ap-a-panel-inner">
          <Logo variant="footer" width={150} priority className="apply-logo" />
          <div className="ap-a-status">
            <ProgressRing value={progress} />
            <div>
              <p className="auth-kicker">Your application</p>
              <strong>{done ? 'Submitted' : cheer}</strong>
              {!done && (
                <small>
                  <ClockIcon /> About {minutesLeft} min left
                </small>
              )}
            </div>
          </div>
          <ol className="ap-journey">
            {steps.map((s, i) => {
              const state = stepState(i);
              const Icon = STEP_ICONS[i];
              return (
                <li key={s.key} className={state} aria-current={state === 'current' ? 'step' : undefined}>
                  {state === 'done' && !done && (
                    <button type="button" className="ap-journey-link" onClick={() => go(firstScreenOf(i))} disabled={pending} aria-label={`Edit ${s.title}`} />
                  )}
                  <span className="ap-journey-dot">{state === 'done' ? <CheckIcon /> : <Icon />}</span>
                  <span className="ap-journey-text">
                    <strong>{s.title}</strong>
                    {partsOf(i) > 1 && state === 'current' && (
                      <span className="ap-parts" aria-label={`Part ${current.part + 1} of ${partsOf(i)}`}>
                        {Array.from({ length: partsOf(i) }, (_, p) => (
                          <i key={p} className={p < current.part ? 'done' : p === current.part ? 'on' : ''} />
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            <li className={done ? 'current' : 'todo'}>
              <span className="ap-journey-dot">
                <ShieldIcon />
              </span>
              <span className="ap-journey-text">
                <strong>Verify your identity</strong>
                <small>Photos of your documents and a quick selfie, after you submit.</small>
              </span>
            </li>
          </ol>
          <p className="apply-secure">
            <LockIcon /> Your information is encrypted and kept confidential.
          </p>
        </div>
      </aside>
      <section className="ap-a-main">
        {!done && (
          <div className="ap-a-mobile">
            {bar}
            {meta}
          </div>
        )}
        <div className="apply-card" ref={topRef}>
          {body}
        </div>
        <p className="auth-foot">
          © {year} {BRAND.legalName}
        </p>
      </section>
    </main>
  );

}
