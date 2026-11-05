'use client';

/**
 * Client application: the personal KYC journey from "Current KYC Journey in MAX CRM" (public/…-form.docx), five steps.
 *   1. Personal Information: given name, surname, date of birth, country of residence, plus the account details
 *      (email + emailed code via POST /api/otp-smtp, password, phone, partner code). Checked on the server before moving on.
 *   2. Identity Information: nationality, document type, name and number as on the document.
 *   3. Proof of Address: country, postal code, address, proof date.
 *   4. Questionnaire: education, employment, income, experience, US citizenship, TIN, PEP declaration.
 *   5. Client Agreement: the two agreements to sign. Submit saves everything (src/app/actions/application.js),
 *      e-mails a confirmation and shows the success panel with the Sumsub verification (SumsubVerification.jsx), which
 *      collects the document photos, the proof of address file and a selfie — nothing is uploaded in this form.
 * Fields, options and rules live in src/lib/application.js. Nothing is saved until the last step.
 * Partner code is read from the URL (?code, ?ref, ?partner_id, ?partner_code, ?ib); ?code / ?ref lock it.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { checkApplication, emailAvailable, submitApplication } from '@/app/actions/application';
import { AGREEMENT_TEXT, EMPTY_APPLICATION, ID_TYPES, OPTIONS, PEP_TEXT, STEPS, STEP_FIELDS, emailError, firstStepWithError, validateAll, validateStep } from '@/lib/application';
import { COUNTRIES, DEFAULT_COUNTRY, countryByCode } from '@/lib/countries';
import { DOC_LABELS } from '@/lib/kyc';
import { BRAND } from '@/lib/brand';
import SumsubVerification from './SumsubVerification';
import DatePicker from './DatePicker';
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, EyeIcon, EyeOffIcon, FileIcon, GlobeIcon, IdCardIcon, LockIcon, MailIcon, PhoneIcon, ShieldIcon, UserIcon } from './icons';

const RESEND_SECONDS = 60;
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const asOptions = (list) => list.map((o) => ({ value: o, label: o }));
const today = () => new Date().toISOString().slice(0, 10);

const HEADS = [
  { title: 'Personal information', text: 'Use your name exactly as it appears on your identity document.' },
  { title: 'Identity information', text: 'Enter the details exactly as they appear on your identity document. You’ll photograph it in the verification step.' },
  { title: 'Proof of address', text: 'Your residential address as shown on a recent utility bill or bank statement. You’ll upload it in the verification step.' },
  { title: 'Questionnaire', text: 'A few questions about your background, as required by our compliance obligations.' },
  { title: 'Client agreement', text: 'Please read the documents below and confirm to sign them electronically.' }
];

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
          {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

export default function LiveApplicationForm() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({ ...EMPTY_APPLICATION, country: DEFAULT_COUNTRY });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [partnerLocked, setPartnerLocked] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeNote, setCodeNote] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, startSending] = useTransition();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(null);
  const topRef = useRef(null);

  // partner code from the URL (after mount, so the page can stay static)
  useEffect(() => {
    const { partner, locked } = readPartner();
    if (partner) setValues((v) => ({ ...v, partnerCode: partner }));
    setPartnerLocked(locked);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const clientErrors = useMemo(() => validateAll(values), [values]);
  const err = (k) => serverErrors[k] ?? (touched[k] ? clientErrors[k] : undefined);
  const country = countryByCode(values.country);

  const clearServer = (k) => setServerErrors(({ [k]: _, ...rest }) => rest);
  const setValue = (k, value) => {
    setValues((v) => ({ ...v, [k]: value }));
    clearServer(k);
  };
  const set = (k) => (e) => setValue(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const go = (i) => {
    setAlert(null);
    setStep(i);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------------------------------------------------------------- field renderers (plain functions, not components) */

  const control = (k, icon, children, extra = '') => (
    <div className={`control${extra}${err(k) ? ' is-bad' : ''}`}>
      {icon && <span className="icon">{icon}</span>}
      {children}
    </div>
  );

  const textField = (k, label, { icon, required = true, optional, hint, wide, ...props } = {}) => (
    <Field id={`ap-${k}`} label={label} required={required && !optional} optional={optional} error={err(k)} hint={hint} wide={wide}>
      {control(
        k,
        icon,
        <input id={`ap-${k}`} value={values[k]} onChange={set(k)} onBlur={blur(k)} aria-invalid={Boolean(err(k))} {...props} />,
        props.type === 'date' ? ' date' : ''
      )}
    </Field>
  );

  const dateField = (k, label, { optional, hint, initialView, max = today() } = {}) => (
    <Field id={`ap-${k}`} label={label} required={!optional} optional={optional} error={err(k)} hint={hint}>
      {control(
        k,
        null,
        <DatePicker id={`ap-${k}`} value={values[k]} onChange={(v) => setValue(k, v)} onBlur={blur(k)} max={max} initialView={initialView} invalid={Boolean(err(k))} />,
        ' date'
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
        ' select'
      )}
    </Field>
  );

  const choiceField = (k, label, options, { wide = true } = {}) => (
    <fieldset className={`choice-field${wide ? ' apply-wide' : ''}`}>
      <legend className="label">
        {label} <span className="required">*</span>
      </legend>
      <div className="chips">
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
            {o.label}
          </label>
        ))}
      </div>
      {err(k) && (
        <p className="field-error" role="alert">
          {err(k)}
        </p>
      )}
    </fieldset>
  );

  const declareField = (k, title, text, children) => (
    <div className="apply-wide">
      <label className={`declare${err(k) ? ' is-bad' : ''}`}>
        <input type="checkbox" checked={values[k]} onChange={set(k)} onBlur={blur(k)} />
        <span>
          {title && <strong>{title}</strong>}
          <span>{text}</span>
        </span>
      </label>
      {children}
      {err(k) && (
        <p className="field-error" role="alert">
          {err(k)}
        </p>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- actions */

  const sendCode = () => {
    setTouched((t) => ({ ...t, email: true }));
    if (emailError(values.email)) return;
    setCodeNote(null);
    startSending(async () => {
      const email = values.email.trim();
      const free = await emailAvailable(email);
      if (!free?.ok) {
        setCodeNote({ tone: 'bad', text: free?.error ?? 'We could not send the code. Please try again.' });
        return;
      }
      let res;
      try {
        const r = await fetch('/api/otp-smtp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, first_name: values.firstName.trim() })
        });
        res = await r.json();
      } catch {
        res = null;
      }
      if (res?.success) {
        setCodeSent(true);
        setCooldown(RESEND_SECONDS);
        setCodeNote({ tone: 'ok', text: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` });
        clearServer('email');
      } else if (res?.reason === 'wait') {
        setCooldown(res.retryIn ?? RESEND_SECONDS);
        setCodeNote({ tone: 'bad', text: 'A code was just sent. Please check your inbox or wait before requesting a new one.' });
      } else if (res?.reason === 'disposable') {
        setCodeNote({ tone: 'bad', text: 'Please use a permanent email address, not a temporary one.' });
      } else if (res?.reason) {
        setCodeNote({ tone: 'bad', text: 'Please enter a valid email address.' });
      } else setCodeNote({ tone: 'bad', text: 'We could not send the code. Please try again.' });
    });
  };

  const next = (e) => {
    e.preventDefault();
    setAlert(null);
    const key = STEPS[step].key;
    setTouched((t) => ({ ...t, ...Object.fromEntries(STEP_FIELDS[key].map((k) => [k, true])) }));
    if (Object.keys(validateStep(key, values)).length) return;

    if (step === 0) {
      startTransition(async () => {
        const res = await checkApplication(values);
        if (res?.ok) {
          setServerErrors({});
          // nationality defaults to the country of residence
          setValues((v) => (v.nationality ? v : { ...v, nationality: v.country }));
          go(1);
        } else {
          setServerErrors(res?.errors ?? {});
          if (res?.error) setAlert(res.error);
        }
      });
      return;
    }
    if (step < STEPS.length - 1) return go(step + 1);

    startTransition(async () => {
      let res;
      try {
        res = await submitApplication(values);
      } catch {
        res = { error: 'We could not send your application. Please check your connection and try again.' };
      }
      if (res?.ok) {
        setDone({ email: res.email, reference: res.reference });
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      setServerErrors(res?.errors ?? {});
      const back = res?.step ?? (res?.errors ? firstStepWithError(res.errors) : -1);
      if (back >= 0 && back !== step) {
        go(back);
        setAlert('Please check the highlighted fields.');
      } else if (res?.error) setAlert(res.error);
    });
  };

  /* ---------------------------------------------------------------- success */

  if (done) {
    return (
      <div className="apply-card" ref={topRef}>
        <div className="apply-success" role="status">
          <span className="apply-success-icon">
            <CheckIcon />
          </span>
          <h2>Application submitted</h2>
          <p>
            Thank you, <span className="cap">{values.firstName}</span>. We’ve received your information and sent a confirmation to <strong>{done.email}</strong>.
          </p>
          <p className="apply-ref">
            Reference <strong>{done.reference}</strong>
          </p>
        </div>
        <SumsubVerification />
      </div>
    );
  }

  /* ---------------------------------------------------------------- steps */

  const last = step === STEPS.length - 1;

  return (
    <div className="apply-card" ref={topRef}>
      <ol className="stepper" aria-label="Application steps">
        {STEPS.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo';
          const inner = (
            <>
              <span className="stepper-dot">{state === 'done' ? <CheckIcon /> : i + 1}</span>
              <span className="stepper-text">{s.title}</span>
            </>
          );
          return (
            <li key={s.key} className={`stepper-item ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'done' ? (
                <button type="button" onClick={() => go(i)} disabled={pending}>
                  {inner}
                </button>
              ) : (
                <span>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="stepper-mobile">
        Step {step + 1} of {STEPS.length} · <strong>{STEPS[step].title}</strong>
      </p>

      {alert && (
        <p className="alert" role="alert">
          {alert}
        </p>
      )}

      <form className="apply-form" onSubmit={next} noValidate>
        <div className="apply-head">
          <span className="pill sm warn">
            <ClockIcon /> Pending submission
          </span>
          <h2>{HEADS[step].title}</h2>
          <p>{HEADS[step].text}</p>
        </div>

        {step === 0 && (
          <div className="apply-grid">
            {textField('lastName', 'Surname', { icon: <UserIcon />, placeholder: 'Surname', autoComplete: 'family-name' })}
            {textField('firstName', 'Given name', { icon: <UserIcon />, placeholder: 'Given name', autoComplete: 'given-name' })}
            {dateField('dateOfBirth', 'Date of birth', { initialView: `${new Date().getFullYear() - 30}-01-01` })}
            {selectField('country', 'Country of residence', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}

            <p className="apply-section apply-wide">Account details</p>
            <Field id="ap-email" label="Email" required error={err('email')}>
              {control(
                'email',
                <MailIcon />,
                <input
                  id="ap-email"
                  type="email"
                  value={values.email}
                  onChange={(e) => {
                    set('email')(e);
                    setCodeSent(false);
                    setCodeNote(null);
                  }}
                  onBlur={blur('email')}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={Boolean(err('email'))}
                />
              )}
            </Field>
            <Field id="ap-code" label="Email verification code" required error={err('code')}>
              {control(
                'code',
                <ShieldIcon />,
                <>
                  <input
                    id="ap-code"
                    value={values.code}
                    onChange={(e) => setValue('code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onBlur={blur('code')}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code"
                    autoComplete="one-time-code"
                    aria-invalid={Boolean(err('code'))}
                  />
                  <button type="button" className="code-btn" onClick={sendCode} disabled={sending || cooldown > 0}>
                    {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : codeSent ? 'Resend code' : 'Get code'}
                  </button>
                </>
              )}
            </Field>
            {codeNote && <p className={`note ${codeNote.tone} apply-wide`}>{codeNote.text}</p>}

            <Field id="ap-password" label="Password" required error={err('password')} hint="At least 8 characters, with a letter and a number.">
              {control(
                'password',
                <LockIcon />,
                <>
                  <input id="ap-password" type={showPw ? 'text' : 'password'} value={values.password} onChange={set('password')} onBlur={blur('password')} placeholder="Create a password" autoComplete="new-password" aria-invalid={Boolean(err('password'))} />
                  <button type="button" className="icon-btn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeIcon /> : <EyeOffIcon />}
                  </button>
                </>
              )}
            </Field>
            <Field id="ap-phone" label="Phone number" required error={err('phone')}>
              <div className={`control${err('phone') ? ' is-bad' : ''}`} dir="ltr">
                <span className="icon">
                  <PhoneIcon />
                </span>
                <span className="dial">{country ? `+${country.dial}` : '+'}</span>
                <input
                  id="ap-phone"
                  type="tel"
                  value={values.phone}
                  onChange={(e) => setValue('phone', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 20))}
                  onBlur={blur('phone')}
                  inputMode="tel"
                  placeholder="50 123 4567"
                  autoComplete="tel-national"
                  aria-invalid={Boolean(err('phone'))}
                />
              </div>
            </Field>
            {/* Partner code field is hidden; a code in the URL (?code, ?ref, …) is still captured into values.partnerCode */}
          </div>
        )}

        {step === 1 && (
          <div className="apply-grid">
            {selectField('nationality', 'Nationality', COUNTRY_OPTIONS, { icon: <GlobeIcon />, placeholder: 'Choose a country' })}
            <div className="apply-spacer" aria-hidden />
            {choiceField('idType', 'Identification document', ID_TYPES.map((t) => ({ value: t, label: DOC_LABELS[t] })))}
            <p className="apply-section apply-wide">As shown on the document</p>
            {textField('idLastName', 'Surname', { icon: <UserIcon />, placeholder: 'Surname on the document' })}
            {textField('idFirstName', 'Given name', { icon: <UserIcon />, placeholder: 'Given name on the document' })}
            {textField('idNumber', 'ID number', { icon: <IdCardIcon />, placeholder: 'Document number', autoComplete: 'off' })}
          </div>
        )}

        {step === 2 && (
          <div className="apply-grid">
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
            </Field>
            {dateField('proofDate', 'Proof date', { optional: true, hint: 'The date printed on the document.' })}
          </div>
        )}

        {step === 3 && (
          <div className="apply-grid">
            {selectField('education', 'Educational level', asOptions(OPTIONS.education))}
            {selectField('employment', 'Employment & financial information', asOptions(OPTIONS.employment))}
            {selectField('industry', 'Industry', asOptions(OPTIONS.industry))}
            {values.industry === 'Other' ? textField('industryOther', 'Please specify your industry', { placeholder: 'Your industry' }) : <div className="apply-spacer" aria-hidden />}
            {selectField('occupation', 'Occupation / job title', asOptions(OPTIONS.occupation))}
            {values.occupation === 'Other' ? textField('occupationOther', 'Please specify your job title', { placeholder: 'Your job title' }) : <div className="apply-spacer" aria-hidden />}
            {textField('employer', 'Name of employer / business', { optional: true, placeholder: 'Employer or business name', autoComplete: 'organization' })}
            {textField('previousEmployment', 'Previous employment', { optional: true, placeholder: 'Previous employer or role' })}

            {choiceField('experienceYears', 'Years of working experience', asOptions(OPTIONS.experienceYears))}
            {choiceField('income', 'What is your estimated annual income?', asOptions(OPTIONS.income))}
            {selectField('sourceOfFunds', 'What is the source of your funds / wealth?', asOptions(OPTIONS.sourceOfFunds), { wide: true })}
            {choiceField('investmentExperience', 'Investment experience', asOptions(OPTIONS.investmentExperience))}
            {choiceField('marketExperience', 'Market investment experience', asOptions(OPTIONS.marketExperience))}
            {choiceField('usCitizen', 'Are you a citizen of the US?', asOptions(OPTIONS.usCitizen), { wide: false })}
            {textField('tin', 'Tax Identification No. (TIN) or its equivalent', { optional: true, placeholder: 'TIN', autoComplete: 'off' })}

            {declareField('pep', 'Politically Exposed Person (PEP)', PEP_TEXT)}
          </div>
        )}

        {step === 4 && (
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
        )}

        <div className="apply-actions">
          {step > 0 && (
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => go(step - 1)}>
              <span className="back-arrow">
                <ArrowRightIcon />
              </span>
              Previous
            </button>
          )}
          <button type="submit" className={`btn btn-grow${last ? ' btn-gold' : ''}`} disabled={pending}>
            {pending ? (
              last ? 'Submitting your application…' : 'Checking…'
            ) : last ? (
              'Submit application'
            ) : (
              <>
                Next: {STEPS[step + 1].title} <ArrowRightIcon />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
