'use client';

/**
 * Client application: the personal KYC journey from "Current KYC Journey in MAX CRM" (public/…-form.docx), five steps,
 * with exactly the fields of the document:
 *   1. Personal Information: surname, given name, date of birth, country of residence, nationality.
 *   Contact details (after 1): email, mobile verified with a 6-digit WhatsApp code (Infobip, POST /api/send-phone-otp),
 *   and the ID number. The send route returns a signed token (no database) that goes back with the code; Continue checks
 *   it on the server (checkContact), submit uses it up, so only a verified mobile is saved. (An e-mail code via
 *   POST /api/otp-smtp is built in but switched off: see the commented lines.)
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
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, MotionConfig, motion, useSpring, useTransform } from 'motion/react';
import Logo from './Logo';
import { checkContact, emailAvailable, submitApplication, uploadApplicationFile } from '@/app/actions/application';
import {
  AGREEMENT_TEXT, EMPTY_APPLICATION, EMPTY_SHAREHOLDER, e164, ID_TYPES, MAX_SHAREHOLDERS, OPTIONS, PEP_TEXT, STEPS, STEP_FIELDS, firstStepWithError, isCorporate, needsBackSide, stepsFor,
  validateAll, validateStep
} from '@/lib/application';
import { COUNTRIES, DEFAULT_COUNTRY, SELECTABLE_COUNTRIES, countryByCode } from '@/lib/countries';
import { DOC_LABELS } from '@/lib/kyc';
import { BRAND } from '@/lib/brand';
import SumsubVerification from './SumsubVerification';

// the 3D globe behind the journey panel loads after the form (three.js stays out of the first load)
const JourneyGlobe = dynamic(() => import('./JourneyGlobe'), { ssr: false });
import DatePicker from './DatePicker';
import CountrySelect from './CountrySelect';
import {
  AlertIcon, ArrowRightIcon, BriefcaseIcon, BuildingIcon, ChartIcon, CheckIcon, ClockIcon, FileIcon, GlobeIcon, HomeIcon, IdCardIcon, LockIcon, MailIcon, PenIcon,
  PhoneIcon, PlusIcon, ShieldIcon, SparkIcon, UploadIcon, UserIcon, UsersIcon, WalletIcon, XIcon
} from './icons';

const ACCEPT = '.pdf,.jpg,.jpeg,.png';
const MAX_BYTES = 4 * 1024 * 1024; // per file, after shrinking (server: actions/application.js)
const RESEND_SECONDS = 60; // matches the one-minute limit of src/lib/otpStore.js
// residence / nationality lists: with the flag, without the countries we don't accept (src/lib/countries.js)
const COUNTRY_OPTIONS = SELECTABLE_COUNTRIES.map((c) => ({ value: c.code, label: `${c.flag}  ${c.name}` }));
const asOptions = (list) => list.map((o) => ({ value: o, label: o }));
const today = () => new Date().toISOString().slice(0, 10);

const STEP_ICONS = [UserIcon, MailIcon, IdCardIcon, HomeIcon, BriefcaseIcon, PenIcon, BuildingIcon, FileIcon, PenIcon];

/**
 * What the client sees, one screen at a time. The questionnaire (step 4) is split into three parts; each part checks
 * only its own fields, the server still validates the whole step.
 */
const SCREENS = [
  { step: 0, Icon: UserIcon, minutes: 1, title: 'Personal information', text: 'Use your name exactly as it appears on your identity document.', cheer: 'Let’s get started' },
  {
    step: 1, Icon: MailIcon, minutes: 2, title: 'Contact details',
    text: 'Enter your email, verify your mobile number with the code we send on WhatsApp, and add your ID number.', cheer: 'Nice start'
  },
  { step: 2, Icon: IdCardIcon, minutes: 2, title: 'Identity information', text: 'Upload clear photos of your document and enter the details exactly as they appear on it.', cheer: 'Nice start' },
  { step: 3, Icon: HomeIcon, minutes: 2, title: 'Proof of address', text: 'Upload a recent utility bill or bank statement and enter the address shown on it.', cheer: 'Almost halfway' },
  {
    step: 4, part: 0, Icon: BriefcaseIcon, minutes: 1, title: 'Work and education', text: 'A few questions about your background, as required by our compliance obligations.', cheer: 'Halfway there',
    fields: ['education', 'employment', 'industry', 'industryOther', 'occupation', 'occupationOther', 'employer', 'previousEmployment']
  },
  { step: 4, part: 1, Icon: WalletIcon, minutes: 1, title: 'Income and funds', text: 'Choose the options that describe you best.', cheer: 'Keep going', fields: ['experienceYears', 'income', 'sourceOfFunds'] },
  {
    step: 4, part: 2, Icon: ChartIcon, minutes: 1, title: 'Experience and declarations', text: 'Your investment background and two short declarations.', cheer: 'Nearly done',
    fields: ['investmentExperience', 'marketExperience', 'usCitizen', 'tin', 'pep']
  },
  { step: 5, Icon: PenIcon, minutes: 1, title: 'Client agreement', text: 'Please read the documents below and confirm to sign them electronically.', cheer: 'Almost there' },
  // corporate clients only (2.6–2.8)
  {
    step: 6, part: 0, Icon: BuildingIcon, minutes: 2, title: 'Company details', text: 'The company exactly as it is registered.', cheer: 'Now your company',
    fields: ['companyName', 'regNumber', 'regDate', 'regCountry', 'regCity', 'regPostalCode', 'regAddress', 'secondaryPhone']
  },
  {
    step: 6, part: 1, Icon: UsersIcon, minutes: 2, title: 'Authorised person and shareholders', text: 'The person acting for the company, and any other shareholders.', cheer: 'Keep going',
    fields: ['repName', 'repPassport', 'repNationality', 'repRatio', 'repAddress', 'repEmail', 'repPhone', 'repOccupation', 'shareholders']
  },
  { step: 7, Icon: FileIcon, minutes: 1, title: 'Business license', text: 'Upload the company’s trade or business license.', cheer: 'Nearly done' },
  { step: 8, Icon: PenIcon, minutes: 1, title: 'Client agreement (corporate)', text: 'Please confirm to sign the agreement for the company electronically.', cheer: 'Last step' }
];
const partsOf = (step) => SCREENS.filter((s) => s.step === step).length;
/** The screens of the steps this client goes through (hidden steps and, for individuals, corporate steps left out). */
const screensFor = (values) => {
  const keys = stepsFor(values).map((s) => s.key);
  return SCREENS.filter((s) => keys.includes(STEPS[s.step].key));
};
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

/** Ring showing the share of the journey done; the arc and the number spring to each new value. */
function ProgressRing({ value, size = 88 }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = useSpring(value, { stiffness: 70, damping: 18 });
  useEffect(() => v.set(value), [v, value]);
  const offset = useTransform(v, (x) => c * (1 - x / 100));
  const label = useTransform(v, (x) => `${Math.round(x)}%`);
  return (
    <span className="ap-ring" style={{ width: size, height: size }} role="img" aria-label={`${value}% complete`}>
      <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="ap-ring-track" />
        <motion.circle cx="36" cy="36" r={r} className="ap-ring-bar" strokeDasharray={c} style={{ strokeDashoffset: offset }} />
      </svg>
      <motion.strong>{label}</motion.strong>
    </span>
  );
}

/** Screens slide in from the side they come from, with a short blur. */
const SCREEN_MOTION = {
  enter: (dir) => ({ opacity: 0, x: dir === 'back' ? -56 : 56, filter: 'blur(6px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
  exit: (dir) => ({ opacity: 0, x: dir === 'back' ? 56 : -56, filter: 'blur(6px)' })
};
const SPRING = { type: 'spring', stiffness: 420, damping: 36 };

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

  const screens = screensFor(values);
  const steps = stepsFor(values);
  const current = screens[screen];
  const stepIndex = current.step; // index in STEPS
  const position = (g) => steps.indexOf(STEPS[g]); // place among the steps shown
  const firstScreenOf = (g) => screens.findIndex((s) => s.step === g);
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

  /** Country list with flags and search (residence, nationality, registration country); blocked countries are not in it. */
  const countryField = (k, label, { wide, placeholder = 'Choose a country' } = {}) => (
    <Field id={`ap-${k}`} label={label} required error={err(k)} wide={wide}>
      {control(
        k,
        null,
        <CountrySelect id={`ap-${k}`} value={values[k]} onChange={(code) => setValue(k, code)} onBlur={blur(k)} countries={SELECTABLE_COUNTRIES} placeholder={placeholder} invalid={Boolean(err(k))} />,
        ' country',
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
            {values[k] === o.value && <motion.span layoutId={`chip-${k}`} className="chip-glow" transition={SPRING} aria-hidden="true" />}
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
            <span className="chip-text">{o.label}</span>
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

  const ratioField = (k, label) => (
    <Field id={`ap-${k}`} label={label} required error={err(k)}>
      {control(
        k,
        null,
        <>
          <input id={`ap-${k}`} value={values[k]} onChange={(e) => setValue(k, e.target.value.replace(/[^\d.]/g, '').slice(0, 6))} onBlur={blur(k)} inputMode="decimal" placeholder="e.g. 51" aria-invalid={Boolean(err(k))} />
          <span className="suffix">%</span>
        </>
      )}
    </Field>
  );

  /**
   * Agreement step (2.5, 2.8): one card per document (Read opens it when a link is set in src/lib/brand.js), an
   * "agree to all" switch, then the signature: the client's name and today's date, shown once everything is accepted.
   */
  const [openDoc, setOpenDoc] = useState(null);
  const signingField = (docs, notice, company) => {
    const allOn = docs.every((d) => values[d.k]);
    // a document with a PDF must be opened (read) before it can be signed; opening it is recorded with the application
    const isRead = (d) => !d.url || values[`${d.k}Read`];
    const toggleDoc = (d) => {
      const opening = openDoc !== d.k;
      setOpenDoc(opening ? d.k : null);
      if (opening) setValues((v) => ({ ...v, [`${d.k}Read`]: true }));
    };
    const setAll = (on) => {
      if (on) {
        // "agree to all" can't skip reading: it opens the first document not read yet instead
        const unread = docs.find((d) => !isRead(d));
        if (unread) return toggleDoc(unread);
      }
      setValues((v) => ({ ...v, ...Object.fromEntries(docs.map((d) => [d.k, on])) }));
      setTouched((t) => ({ ...t, ...Object.fromEntries(docs.map((d) => [d.k, true])) }));
      setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !docs.some((d) => d.k === k))));
    };
    const name = [values.firstName, values.lastName].filter(Boolean).join(' ');
    const signedOn = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return (
      <div className="sign">
        {docs.length > 1 && (
          <label className={`agree-all${allOn ? ' is-on' : ''}`}>
            <input type="checkbox" checked={allOn} onChange={(e) => setAll(e.target.checked)} />
            <span className="agree-switch" aria-hidden="true" />
            <span>
              <strong>I agree to all documents</strong>
              <small>{docs.filter((d) => values[d.k]).length} of {docs.length} accepted</small>
            </span>
          </label>
        )}
        <ol className="docs">
          {docs.map((d, i) => (
            <li key={d.k} className={`doc${values[d.k] ? ' is-on' : ''}${err(d.k) ? ' is-bad' : ''}`}>
              <div
                className={`doc-head${d.url ? ' is-link' : ''}`}
                onClick={d.url ? () => toggleDoc(d) : undefined}
              >
                <span className="doc-icon">
                  <FileIcon />
                  {values[d.k] && (
                    <i className="doc-check">
                      <CheckIcon />
                    </i>
                  )}
                </span>
                <span className="doc-title">
                  <small>Document {i + 1}</small>
                  <strong>{d.title}</strong>
                </span>
                {d.url && (
                  // no handler of its own: the click reaches the row above, which opens / closes the document
                  <button type="button" className="file-btn" aria-expanded={openDoc === d.k}>
                    {openDoc === d.k ? 'Close' : 'Read & sign'}
                  </button>
                )}
              </div>
              {d.url && openDoc === d.k && (
                <div className="agreement-doc ap-pop">
                  <iframe src={d.url} title={d.title} loading="lazy" />
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="help-link">
                    <FileIcon /> Open in a new tab
                  </a>
                  <p className="agreement-hint">
                    <PenIcon /> After reading, tick the box below to sign this document electronically.
                  </p>
                </div>
              )}
              <label className={`doc-accept${isRead(d) ? '' : ' is-locked'}`} onClick={!isRead(d) ? () => toggleDoc(d) : undefined}>
                <input type="checkbox" checked={values[d.k]} onChange={set(d.k)} onBlur={blur(d.k)} disabled={!isRead(d)} />
                <span className="declare-box" aria-hidden="true">
                  <CheckIcon />
                </span>
                <span>
                  {AGREEMENT_TEXT}
                  {!isRead(d) && (
                    <strong className="doc-lock">
                      <LockIcon /> Open and read “{d.title}” first (press Read &amp; sign above) to unlock this box.
                    </strong>
                  )}
                </span>
              </label>
              {err(d.k) && (
                <p className="field-error" role="alert">
                  <AlertIcon /> {err(d.k)}
                </p>
              )}
            </li>
          ))}
        </ol>
        <div className={`signature${allOn ? ' is-signed' : ''}`} aria-live="polite">
          <div className="signature-line">
            {allOn ? (
              <span className="signature-name" key={name}>
                {name || 'Your signature'}
              </span>
            ) : (
              <span className="signature-wait">
                <PenIcon /> Your signature appears here once you accept {docs.length > 1 ? 'all documents' : 'the agreement'}
              </span>
            )}
          </div>
          <dl className="signature-meta">
            <div>
              <dt>Signed by</dt>
              <dd className="cap">{name || '—'}</dd>
            </div>
            {company && (
              <div>
                <dt>On behalf of</dt>
                <dd>{company}</dd>
              </div>
            )}
            <div>
              <dt>Date</dt>
              <dd>{signedOn}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>Electronic signature</dd>
            </div>
          </dl>
          <p className="signature-note">
            <LockIcon /> {notice}
          </p>
        </div>
      </div>
    );
  };

  /** 2.6 "Shareholders": optional, add as many as needed (name, passport, nationality, ratio). */
  const shareholders = values.shareholders ?? [];
  const setShareholders = (list) => setValue('shareholders', list);
  const editHolder = (i, key, value) => setShareholders(shareholders.map((x, n) => (n === i ? { ...x, [key]: value } : x)));
  const shareholdersField = () => (
    <div className="apply-wide holders">
      {shareholders.map((h, i) => (
        <div key={i} className="holder">
          <div className="holder-head">
            <strong>
              <UsersIcon /> Shareholder {i + 1}
            </strong>
            <button type="button" className="file-btn icon" onClick={() => setShareholders(shareholders.filter((_, n) => n !== i))} aria-label={`Remove shareholder ${i + 1}`}>
              <XIcon />
            </button>
          </div>
          <div className="holder-grid">
            <div className="control">
              <input aria-label={`Shareholder ${i + 1} name`} value={h.name} onChange={(e) => editHolder(i, 'name', e.target.value)} placeholder="Name" />
            </div>
            <div className="control">
              <input aria-label={`Shareholder ${i + 1} passport`} value={h.passport} onChange={(e) => editHolder(i, 'passport', e.target.value)} placeholder="Passport number" />
            </div>
            <div className="control select">
              <select aria-label={`Shareholder ${i + 1} nationality`} value={h.nationality} onChange={(e) => editHolder(i, 'nationality', e.target.value)} className={h.nationality ? '' : 'is-empty'}>
                <option value="" disabled>
                  Nationality
                </option>
                {COUNTRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control">
              <input
                aria-label={`Shareholder ${i + 1} shareholding ratio`}
                value={h.ratio}
                onChange={(e) => editHolder(i, 'ratio', e.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
                inputMode="decimal"
                placeholder="Ratio"
              />
              <span className="suffix">%</span>
            </div>
          </div>
        </div>
      ))}
      {shareholders.length < MAX_SHAREHOLDERS && (
        <button type="button" className="holder-add" onClick={() => setShareholders([...shareholders, { ...EMPTY_SHAREHOLDER }])}>
          <PlusIcon /> Add a shareholder
        </button>
      )}
      {err('shareholders') && (
        <p className="field-error" role="alert">
          <AlertIcon /> {err('shareholders')}
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

  /* ---------------------------------------------------------------- contact details: WhatsApp code (e-mail code switched off) */

  // per channel: sending (request in flight), sent (a code went out), cooldown (seconds before "Resend"), note (message)
  const [codes, setCodes] = useState({ email: {}, phone: {} });
  const setCode = (ch, patch) => setCodes((c) => ({ ...c, [ch]: { ...c[ch], ...patch } }));
  const cooling = codes.email.cooldown > 0 || codes.phone.cooldown > 0;
  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(
      () => setCodes((c) => Object.fromEntries(Object.entries(c).map(([ch, s]) => [ch, s.cooldown > 0 ? { ...s, cooldown: s.cooldown - 1 } : s]))),
      1000
    );
    return () => clearInterval(t);
  }, [cooling]);

  // a new address / number needs a new code (and drops the token of the old one)
  const changeContact = (k, value, ch) => {
    setValue(k, value);
    if (codes[ch].sent || codes[ch].note) setCode(ch, { sent: false, note: null });
    if (values[`${ch}Code`]) setValue(`${ch}Code`, '');
    if (values[`${ch}Token`]) setValue(`${ch}Token`, '');
  };

  const sendCode = async (ch) => {
    const k = ch === 'email' ? 'email' : 'phone';
    setTouched((t) => ({ ...t, [k]: true, ...(ch === 'phone' ? { phoneCountry: true } : {}) }));
    const stepErrors = validateStep('contact', values);
    if (stepErrors[k] || (ch === 'phone' && stepErrors.phoneCountry)) return;

    setCode(ch, { sending: true, note: null });
    let res;
    try {
      if (ch === 'email') {
        const free = await emailAvailable(values.email);
        if (!free?.ok) {
          setCode(ch, { sending: false, note: { tone: 'bad', text: free?.error ?? 'We could not send the code. Please try again.' } });
          return;
        }
      }
      const r = await fetch(ch === 'email' ? '/api/otp-smtp' : '/api/send-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          ch === 'email'
            ? { email: values.email.trim(), first_name: values.firstName.trim() }
            : { phone: e164(values.phoneCountry, values.phone), locale: 'en' }
        )
      });
      res = await r.json();
    } catch {
      res = null;
    }
    const where = ch === 'email' ? values.email.trim() : `+${e164(values.phoneCountry, values.phone).slice(1)}`;
    if (res?.success) {
      // the signed token goes back to the server with the code (src/lib/otpStore.js); it doesn't contain the code
      setValue(`${ch}Token`, res.token ?? '');
      setCode(ch, { sending: false, sent: true, cooldown: RESEND_SECONDS, note: { tone: 'ok', text: ch === 'email' ? `Code sent to ${where}. It expires in 10 minutes.` : `Code sent on WhatsApp to ${where}. It expires in 10 minutes.` } });
      clearServer(k);
      document.getElementById(`ap-${ch}Code`)?.focus();
    } else if (res?.reason === 'wait') {
      setCode(ch, { sending: false, cooldown: res.retryIn ?? RESEND_SECONDS, note: { tone: 'bad', text: 'A code was just sent. Please check it, or wait before requesting a new one.' } });
    } else if (res?.reason === 'disposable') {
      setCode(ch, { sending: false, note: { tone: 'bad', text: 'Please use a permanent email address, not a temporary one.' } });
    } else {
      setCode(ch, { sending: false, note: { tone: 'bad', text: res?.message && ch === 'phone' ? res.message : 'We could not send the code. Please try again.' } });
    }
  };

  const sendButton = (ch) => {
    const c = codes[ch];
    return (
      <button type="button" className="code-btn" onClick={() => sendCode(ch)} disabled={c.sending || c.cooldown > 0}>
        {c.sending ? 'Sending…' : c.cooldown > 0 ? `Resend in ${c.cooldown}s` : c.sent ? 'Resend code' : ch === 'phone' ? 'Send on WhatsApp' : 'Send code'}
      </button>
    );
  };

  const codeField = (ch, label) => {
    const k = `${ch}Code`;
    return (
      <Field id={`ap-${k}`} label={label} required error={err(k)}>
        {control(
          k,
          <ShieldIcon />,
          <input
            id={`ap-${k}`}
            value={values[k]}
            onChange={(e) => setValue(k, e.target.value.replace(/\D/g, '').slice(0, 6))}
            onBlur={blur(k)}
            inputMode="numeric"
            maxLength={6}
            placeholder={codes[ch].sent ? '6-digit code' : 'Send the code first'}
            autoComplete="one-time-code"
            aria-invalid={Boolean(err(k))}
          />
        )}
      </Field>
    );
  };

  const note = (ch) =>
    codes[ch].note && (
      <p className={`note ${codes[ch].note.tone} apply-wide ap-pop`} role="status">
        {codes[ch].note.tone === 'ok' ? <CheckIcon /> : <AlertIcon />} {codes[ch].note.text}
      </p>
    );

  const phoneDial = countryByCode(values.phoneCountry)?.dial;
  const contactFields = () => (
    <div className="apply-grid">
      <Field id="ap-email" label="Email" required error={err('email')} wide>
        {control(
          'email',
          <MailIcon />,
          <>
            <input
              id="ap-email"
              type="email"
              value={values.email}
              onChange={(e) => changeContact('email', e.target.value, 'email')}
              onBlur={blur('email')}
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={Boolean(err('email'))}
            />
            {/* e-mail code switched off (only the WhatsApp code is asked for): {sendButton('email')} */}
          </>
        )}
      </Field>
      {/* e-mail code switched off:
      {codeField('email', 'Email verification code')}
      {note('email')}
      */}

      <Field id="ap-phone" label="Mobile number (WhatsApp)" required error={err('phone') ?? err('phoneCountry')}>
        <div className={`control${err('phone') || err('phoneCountry') ? ' is-bad' : ''}`} dir="ltr">
          <span className="icon">
            <PhoneIcon />
          </span>
          <span className="dial-pick">
            <span aria-hidden="true">{phoneDial ? `+${phoneDial}` : 'Code'}</span>
            <select aria-label="Country code" value={values.phoneCountry} onChange={(e) => changeContact('phoneCountry', e.target.value, 'phone')} onBlur={blur('phoneCountry')}>
              <option value="" disabled>
                Country code
              </option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag}  {c.name} (+{c.dial})
                </option>
              ))}
            </select>
          </span>
          <input
            id="ap-phone"
            type="tel"
            value={values.phone}
            onChange={(e) => changeContact('phone', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 20), 'phone')}
            onBlur={blur('phone')}
            inputMode="tel"
            placeholder="50 123 4567"
            autoComplete="tel-national"
            aria-invalid={Boolean(err('phone'))}
          />
          {sendButton('phone')}
        </div>
      </Field>
      {codeField('phone', 'WhatsApp verification code')}
      {note('phone')}

      {textField('idNumber', 'ID number', { icon: <IdCardIcon />, placeholder: 'Passport or national ID number', autoComplete: 'off', hint: 'As shown on the identity document you will verify with.' })}
    </div>
  );

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

    // contact details: the server checks the e-mail is free and both codes are right before the client moves on
    if (key === 'contact') {
      startTransition(async () => {
        let res;
        try {
          res = await checkContact(values);
        } catch {
          res = { error: 'Could not reach the server. Please check your connection and try again.' };
        }
        if (res?.ok) {
          setServerErrors({});
          go(screen + 1);
        } else {
          setServerErrors(res?.errors ?? {});
          if (res?.error) setAlert(res.error);
          setShake((n) => n + 1);
        }
      });
      return;
    }

    // after step 1, the proof of address country and the mobile's country code start as the country of residence;
    // the business license starts with the company name and number from the company details
    if (screen === 0) setValues((v) => ({ ...v, poaCountry: v.poaCountry || v.country, phoneCountry: v.phoneCountry || v.country }));
    if (screens[screen + 1]?.step === STEPS.findIndex((x) => x.key === 'license')) setValues((v) => ({ ...v, licenseCompanyName: v.licenseCompanyName || v.companyName, licenseRegNumber: v.licenseRegNumber || v.regNumber }));
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

  const stepState = (g) => {
    const p = position(g);
    const now = position(stepIndex);
    return done || p < now ? 'done' : p === now ? 'current' : 'todo';
  };

  const bar = (
    <div className="ap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Application progress">
      <span style={{ width: `${Math.max(progress, 4)}%` }} />
    </div>
  );

  const meta = (
    <p className="ap-meta">
      <span>
        Step {position(stepIndex) + 1} of {steps.length}
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
    switch (SCREENS.indexOf(current)) { // the layout belongs to the screen, whatever its place in this journey
      case 0:
        return (
          <div className="apply-grid">
            {choiceField(
              'accountType',
              'Account type',
              [
                { value: 'individual', label: 'Individual' },
                { value: 'corporate', label: 'Corporate' }
              ],
              { cols: 2 }
            )}
            {textField('lastName', 'Surname', { icon: <UserIcon />, placeholder: 'Surname', autoComplete: 'family-name' })}
            {textField('firstName', 'Given name', { icon: <UserIcon />, placeholder: 'Given name', autoComplete: 'given-name' })}
            {dateField('dateOfBirth', 'Date of birth', { initialView: `${new Date().getFullYear() - 30}-01-01` })}
            {countryField('country', 'Country of residence')}
            {countryField('nationality', 'Nationality')}
          </div>
        );
      case 1:
        return contactFields();
      case 2:
        return (
          <div className="apply-grid">
            {countryField('nationality', 'Nationality')}
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
      case 3:
        return (
          <div className="apply-grid">
            {fileField('poaFile', 'Utilities & bank statements', { wide: true, hint: 'A utility bill or bank statement from the last 3 months showing your name and address · JPG, PNG or PDF' })}
            {countryField('poaCountry', 'Country (region) of residence')}
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
      case 4:
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
      case 5:
        return (
          <div className="apply-grid">
            {choiceField('experienceYears', 'Years of working experience', asOptions(OPTIONS.experienceYears), { cols: 5 })}
            {choiceField('income', 'What is your estimated annual income?', asOptions(OPTIONS.income), { cols: 3 })}
            {selectField('sourceOfFunds', 'What is the source of your funds / wealth?', asOptions(OPTIONS.sourceOfFunds), { wide: true })}
          </div>
        );
      case 6:
        return (
          <div className="apply-grid">
            {choiceField('investmentExperience', 'Investment experience', asOptions(OPTIONS.investmentExperience), { cols: 4 })}
            {choiceField('marketExperience', 'Market investment experience', asOptions(OPTIONS.marketExperience), { cols: 4 })}
            {choiceField('usCitizen', 'Are you a citizen of the US?', asOptions(OPTIONS.usCitizen), { wide: false, cols: 2 })}
            {textField('tin', 'Tax Identification No. (TIN) or its equivalent', { optional: true, placeholder: 'TIN', autoComplete: 'off' })}
            {declareField('pep', 'Politically Exposed Person (PEP)', PEP_TEXT)}
          </div>
        );
      case 7:
        return signingField(
          BRAND.agreements.map((a, i) => ({ k: `agreement${i + 1}`, title: a.title, url: a.url })),
          'By signing, you accept these documents electronically. Your signature is equivalent to a handwritten one.'
        );
      case 8:
        return (
          <div className="apply-grid">
            {textField('companyName', 'Company name', { icon: <BuildingIcon />, placeholder: 'As registered', autoComplete: 'organization', wide: true })}
            {textField('regNumber', 'Registration number', { placeholder: 'Registration number', autoComplete: 'off' })}
            {dateField('regDate', 'Registration date', { initialView: `${new Date().getFullYear() - 5}-01-01` })}
            {countryField('regCountry', 'Registration country')}
            {textField('regCity', 'Registration city', { placeholder: 'City' })}
            {textField('regPostalCode', 'Postal code', { placeholder: 'Postal code' })}
            {textField('secondaryPhone', 'Secondary phone number', { optional: true, icon: <PhoneIcon />, type: 'tel', inputMode: 'tel', placeholder: '+971 4 123 4567' })}
            <Field id="ap-regAddress" label="Registration address" required error={err('regAddress')} wide>
              <textarea
                id="ap-regAddress"
                className={`textarea${err('regAddress') ? ' is-bad' : ''}`}
                value={values.regAddress}
                onChange={set('regAddress')}
                onBlur={blur('regAddress')}
                rows={2}
                maxLength={300}
                placeholder="Office / building, street, area, city"
                aria-invalid={Boolean(err('regAddress'))}
              />
            </Field>
          </div>
        );
      case 9:
        return (
          <div className="apply-grid">
            <p className="apply-section apply-wide">Authorised person</p>
            {textField('repName', 'Name', { icon: <UserIcon />, placeholder: 'Full name as on the passport' })}
            {textField('repPassport', 'Passport', { icon: <IdCardIcon />, placeholder: 'Passport number', autoComplete: 'off' })}
            {countryField('repNationality', 'Nationality')}
            {ratioField('repRatio', 'Shareholding ratio')}
            {textField('repEmail', 'Email', { icon: <MailIcon />, type: 'email', placeholder: 'name@company.com', autoComplete: 'email' })}
            {textField('repPhone', 'Phone number', { icon: <PhoneIcon />, type: 'tel', inputMode: 'tel', placeholder: '+971 50 123 4567', autoComplete: 'tel' })}
            {textField('repOccupation', 'Occupation', { icon: <BriefcaseIcon />, placeholder: 'e.g. Director' })}
            {textField('repAddress', 'Residential address', { icon: <HomeIcon />, placeholder: 'Building, street, area, city' })}
            <p className="apply-section apply-wide">
              Shareholders <span className="optional">(optional)</span>
            </p>
            {shareholdersField()}
          </div>
        );
      case 10:
        return (
          <div className="apply-grid">
            {textField('licenseCompanyName', 'Company name', { icon: <BuildingIcon />, placeholder: 'As on the license' })}
            {textField('licenseRegNumber', 'Registration number', { placeholder: 'As on the license', autoComplete: 'off' })}
            {fileField('licenseFile', 'License photo', { wide: true, hint: 'The full trade or business license, every page readable · JPG, PNG or PDF' })}
          </div>
        );
      default:
        return signingField(
          [{ k: 'corporateAgreement', title: BRAND.corporateAgreement.title, url: BRAND.corporateAgreement.url }],
          'By signing, you accept this agreement electronically on behalf of the company.',
          values.companyName
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
      <motion.button type="submit" className={`btn btn-grow btn-next${last ? ' btn-gold' : ''}${pending ? ' is-busy' : ''}`} disabled={pending} whileTap={{ scale: 0.97 }} transition={SPRING}>
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
      </motion.button>
    </div>
  );

  const form = (
    <form className="apply-form" onSubmit={next} noValidate>
      {alert && (
        <p className="alert ap-pop" role="alert">
          {alert}
        </p>
      )}
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.div key={SCREENS.indexOf(current)} className="ap-screen" custom={dir} variants={SCREEN_MOTION} initial="enter" animate="center" exit="exit" transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
          {head}
          <div key={`s-${shake}`} className={shake ? 'ap-shake' : undefined}>
            {fieldsFor()}
          </div>
        </motion.div>
      </AnimatePresence>
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
          Thank you, <span className="cap">{values.firstName}</span>. We’ve received your application. Please complete the identity verification below.
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

  /* ---------------------------------------------------------------- layout */

  // a soft light follows the pointer across the form side (CSS variables, no re-render)
  const spot = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const stepsDone = done ? steps.length : position(stepIndex);

  return (
    <MotionConfig reducedMotion="user">
      <main className="ap">
        <aside className="ap-a-panel">
          <JourneyGlobe done={stepsDone} total={steps.length} finished={Boolean(done)} />
          <div className="ap-a-panel-inner">
            <Logo variant="footer" width={150} priority className="apply-logo" />
            <div className="ap-a-status ap-enter">
              <ProgressRing value={progress} />
              <div>
                <p className="auth-kicker">Your application</p>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.strong key={done ? 'done' : cheer} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                    {done ? 'Submitted' : cheer}
                  </motion.strong>
                </AnimatePresence>
                {!done && (
                  <small>
                    <ClockIcon /> About {minutesLeft} min left
                  </small>
                )}
              </div>
            </div>
            <ol className="ap-journey">
              <AnimatePresence initial={false}>
                {steps.map((s, i) => {
                  const g = STEPS.indexOf(s);
                  const state = stepState(g);
                  const Icon = STEP_ICONS[g];
                  return (
                    <motion.li
                      key={s.key}
                      layout
                      className={state}
                      aria-current={state === 'current' ? 'step' : undefined}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + i * 0.06 } }}
                      exit={{ opacity: 0, x: -16 }}
                    >
                      {state === 'current' && <motion.span layoutId="journey-now" className="ap-journey-glow" transition={SPRING} aria-hidden="true" />}
                      {state === 'done' && !done && (
                        <button type="button" className="ap-journey-link" onClick={() => go(firstScreenOf(g))} disabled={pending} aria-label={`Edit ${s.title}`} />
                      )}
                      <span className="ap-journey-dot">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span key={state === 'done' ? 'ok' : 'icon'} className="ap-journey-icon" initial={{ scale: 0.3, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }} transition={SPRING}>
                            {state === 'done' ? <CheckIcon /> : <Icon />}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                      <span className="ap-journey-text">
                        <strong>{s.title}</strong>
                        {partsOf(g) > 1 && state === 'current' && (
                          <span className="ap-parts" aria-label={`Part ${current.part + 1} of ${partsOf(g)}`}>
                            {Array.from({ length: partsOf(g) }, (_, p) => (
                              <i key={p} className={p < current.part ? 'done' : p === current.part ? 'on' : ''} />
                            ))}
                          </span>
                        )}
                      </span>
                    </motion.li>
                  );
                })}
                <motion.li key="verify" layout className={done ? 'current' : 'todo'} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + steps.length * 0.06 } }}>
                  {done && <motion.span layoutId="journey-now" className="ap-journey-glow" transition={SPRING} aria-hidden="true" />}
                  <span className="ap-journey-dot">
                    <ShieldIcon />
                  </span>
                  <span className="ap-journey-text">
                    <strong>Verify your identity</strong>
                    <small>Your ID, proof of address, a short questionnaire and a selfie, with Sumsub after you submit.</small>
                  </span>
                </motion.li>
              </AnimatePresence>
            </ol>
            <p className="apply-secure">
              <LockIcon /> Your information is encrypted and kept confidential.
            </p>
          </div>
        </aside>
        <section className="ap-a-main" onPointerMove={spot}>
          {!done && (
            <div className="ap-a-mobile">
              {bar}
              {meta}
            </div>
          )}
          {/* page-load entrances are CSS (.ap-enter), so the form shows even before the JavaScript has loaded */}
          <div className="apply-card ap-enter" ref={topRef}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={done ? 'done' : 'form'} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.35 }}>
                {body}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="auth-foot">
            © {year} {BRAND.legalName}
          </p>
        </section>
      </main>
    </MotionConfig>
  );
}
