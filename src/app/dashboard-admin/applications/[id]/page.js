import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { ADMIN_HOME } from '@/lib/adminRoutes';
import { getApplication, VERIFICATION } from '@/lib/adminData';
import AdminShell, { StatusPill } from '../../AdminShell';
import CopyButton from '../../CopyButton';
import Icon from '../../Icon';
import { ago, avatarTone, countryLabel, dateOnly, dateTime, docTypeLabel, fileSize, fullName, initials, phoneLabel } from '../../format';
import RevealField from './RevealField';

export const dynamic = 'force-dynamic';

const yesNo = (v) => (v === 1 || v === true || v === '1' || /^yes$/i.test(String(v)) ? 'Yes' : v === 0 || v === false || v === '0' || /^no$/i.test(String(v)) ? 'No' : '—');
const text = (v) => (v == null || v === '' ? '—' : String(v));
const withOther = (v, other) => (v === 'Other' && other ? `Other: ${other}` : text(v));

function Field({ label, children, wide }) {
  return (
    <div className={`ad-field-row${wide ? ' is-wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  );
}

/** `empty` → a slim card that says why there is nothing, instead of a grid of dashes. */
function Section({ title, hint, empty, children }) {
  if (empty) {
    return (
      <section className="ad-card ad-section ad-section-empty">
        <h2>{title}</h2>
        <p className="ad-muted">Not collected in the application form. {empty}</p>
      </section>
    );
  }
  return (
    <section className="ad-card ad-section">
      <header>
        <h2>{title}</h2>
        {hint && <p className="ad-muted">{hint}</p>}
      </header>
      <dl className="ad-grid">{children}</dl>
    </section>
  );
}

const FILE_LABELS = { idFront: 'ID document, front', idBack: 'ID document, back', poaFile: 'Proof of address', licenseFile: 'Business licence' };

export default async function ApplicationPage({ params }) {
  const admin = await requireAdmin();
  const { id } = await params;

  let record;
  try {
    record = await getApplication(id);
  } catch (err) {
    console.error('[admin] application:', err.message);
    return (
      <AdminShell admin={admin} active="applications">
        <Link href={`${ADMIN_HOME}#applications`} className="ad-back">
          <Icon name="arrowLeft" size={16} /> All applications
        </Link>
        <div className="ad-note ad-note-bad" role="alert">
          <strong>The database could not be reached.</strong>
          <p>Reload the page in a moment.</p>
        </div>
      </AdminShell>
    );
  }
  if (!record) notFound();

  const { app, verification, files, documents } = record;
  const status = VERIFICATION[verification?.status ?? 'not_started'] ?? VERIFICATION.not_started;
  const corporate = app.accountType === 'corporate';
  const co = app.company;
  const rep = co?.authorisedPerson;
  const anyOf = (...keys) => keys.some((k) => app[k] != null && app[k] !== '');
  const noAddress = !anyOf('poaCountry', 'postalCode', 'address', 'proofDate');
  const noFinancial = !anyOf('education', 'employment', 'industry', 'occupation', 'employer', 'income', 'sourceOfFunds', 'investmentExperience', 'marketExperience', 'usCitizen', 'pep') && !app.hasTin;

  // the review checklist under the name: one glance tells what is done and what is missing
  const vs = verification?.status ?? 'not_started';
  const agreementsOk = app.agreements.length > 0 && app.agreements.every((a) => a.accepted);
  const fileCount = files.length + documents.length;
  const checklist = [
    { icon: 'phone', label: 'Mobile verified', state: app.phoneVerifiedAt ? 'ok' : 'todo', note: app.phoneVerifiedAt ? dateTime(app.phoneVerifiedAt) : 'Not verified' },
    { icon: 'mail', label: 'Email verified', state: app.emailVerifiedAt ? 'ok' : 'todo', note: app.emailVerifiedAt ? dateTime(app.emailVerifiedAt) : 'Not verified' },
    { icon: 'pen', label: 'Agreements signed', state: agreementsOk ? 'ok' : 'todo', note: agreementsOk ? 'All accepted' : 'Not accepted' },
    { icon: 'shield', label: 'Identity check', state: { approved: 'ok', pending: 'warn', started: 'warn', rejected: 'bad', resubmit: 'bad' }[vs] ?? 'todo', note: status.label },
    { icon: 'file', label: 'Documents on file', state: fileCount ? 'ok' : 'todo', note: fileCount ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'}` : 'None yet' }
  ];
  const stateIcon = { ok: 'check', warn: 'clock', bad: 'x', todo: 'minus' };
  const flags = [
    corporate && { tone: 'info', text: 'Corporate account' },
    yesNo(app.pep) === 'Yes' && { tone: 'warn', text: 'Politically exposed person' },
    yesNo(app.usCitizen) === 'Yes' && { tone: 'warn', text: 'US citizen / tax resident' }
  ].filter(Boolean);

  return (
    <AdminShell admin={admin} active="applications">
      <Link href={`${ADMIN_HOME}#applications`} className="ad-back">
        <Icon name="arrowLeft" size={16} /> All applications
      </Link>

      <section className="ad-profile">
        <span className={`ad-avatar ad-avatar-lg ad-av-${avatarTone(app)}`}>{initials(app)}</span>
        <div className="ad-profile-main">
          <h1>{fullName(app)}</h1>
          <p className="ad-muted">
            {app.applicationReference ?? `Application #${app.id}`} · {corporate ? 'Corporate account' : 'Individual account'} · Submitted {dateTime(app.submittedAt)}
            {app.submittedAt ? ` (${ago(app.submittedAt)})` : ''}
          </p>
          <div className="ad-contact">
            <span>
              <Icon name="mail" size={15} />
              <a href={`mailto:${app.email}`}>{app.email}</a>
              <CopyButton value={app.email} label="Copy email" />
            </span>
            {app.phone && (
              <span>
                <Icon name="phone" size={15} />
                {phoneLabel(app.phone, app.phoneCountry || app.country)}
                <CopyButton value={phoneLabel(app.phone, app.phoneCountry || app.country)} label="Copy phone" />
              </span>
            )}
            <span>
              <Icon name="globe" size={15} />
              {countryLabel(app.country)}
            </span>
          </div>
          {flags.length > 0 && (
            <div className="ad-flags">
              {flags.map((f) => (
                <StatusPill key={f.text} tone={f.tone}>
                  {f.text}
                </StatusPill>
              ))}
            </div>
          )}
        </div>
        <div className="ad-profile-status">
          <span className="ad-muted">Verification</span>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          {app.applicationReference && <CopyButton value={app.applicationReference} label="Copy reference" />}
        </div>
      </section>

      <section className="ad-checklist" aria-label="Review checklist">
        {checklist.map((c) => (
          <div key={c.label} className={`ad-check ad-check-${c.state}`}>
            <span className="ad-check-icon">
              <Icon name={stateIcon[c.state]} size={16} />
            </span>
            <div>
              <strong>{c.label}</strong>
              <small>{c.note}</small>
            </div>
          </div>
        ))}
      </section>

      <div className="ad-cols">
        <div className="ad-col">
          <Section title="Personal information">
            <Field label="First name">{text(app.firstName)}</Field>
            <Field label="Last name">{text(app.lastName)}</Field>
            <Field label="Date of birth">{dateOnly(app.dateOfBirth)}</Field>
            <Field label="Country of residence">{countryLabel(app.country)}</Field>
            <Field label="Nationality">{countryLabel(app.nationality)}</Field>
            <Field label="Partner code">{text(app.partnerCode)}</Field>
          </Section>

          <Section title="Contact details">
            <Field label="Email">{text(app.email)}</Field>
            <Field label="Email verified">{app.emailVerifiedAt ? dateTime(app.emailVerifiedAt) : 'Not verified'}</Field>
            <Field label="Mobile (WhatsApp)">{phoneLabel(app.phone, app.phoneCountry || app.country)}</Field>
            <Field label="Mobile verified">{app.phoneVerifiedAt ? dateTime(app.phoneVerifiedAt) : 'Not verified'}</Field>
          </Section>

          <Section title="Identity" hint="Protected values stay hidden until you reveal them. Each reveal is recorded.">
            <Field label="ID type">{app.idType ? docTypeLabel(app.idType) : '—'}</Field>
            <Field label="ID number">{app.hasIdNumber ? <RevealField applicationId={String(app.id)} field="idNumber" /> : '—'}</Field>
            <Field label="Name on the document">{[app.idFirstName, app.idLastName].filter(Boolean).join(' ') || '—'}</Field>
          </Section>

          <Section title="Proof of address" empty={noAddress ? 'Check the identity verification result on the right, or the files uploaded by the client.' : ''}>
            <Field label="Country">{countryLabel(app.poaCountry)}</Field>
            <Field label="Postal code">{text(app.postalCode)}</Field>
            <Field label="Document date">{dateOnly(app.proofDate)}</Field>
            <Field label="Address" wide>{text(app.address)}</Field>
          </Section>

          <Section title="Financial profile" empty={noFinancial ? 'The questionnaire step is switched off for now.' : ''}>
            <Field label="Education">{text(app.education)}</Field>
            <Field label="Employment">{text(app.employment)}</Field>
            <Field label="Industry">{withOther(app.industry, app.industryOther)}</Field>
            <Field label="Occupation">{withOther(app.occupation, app.occupationOther)}</Field>
            <Field label="Employer">{text(app.employer)}</Field>
            <Field label="Previous employment">{text(app.previousEmployment)}</Field>
            <Field label="Years of experience">{text(app.experienceYears)}</Field>
            <Field label="Annual income">{text(app.income)}</Field>
            <Field label="Source of funds">{text(app.sourceOfFunds)}</Field>
            <Field label="Investment experience">{text(app.investmentExperience)}</Field>
            <Field label="Market experience">{text(app.marketExperience)}</Field>
            <Field label="Tax identification number">{app.hasTin ? <RevealField applicationId={String(app.id)} field="tin" /> : '—'}</Field>
            <Field label="US citizen / tax resident">{yesNo(app.usCitizen)}</Field>
            <Field label="Politically exposed person">{yesNo(app.pep)}</Field>
          </Section>

          {corporate && co && (
            <>
              <Section title="Company">
                <Field label="Company name">{text(co.name)}</Field>
                <Field label="Registration number">{text(co.registrationNumber)}</Field>
                <Field label="Registration date">{dateOnly(co.registrationDate)}</Field>
                <Field label="Country">{countryLabel(co.registrationCountry)}</Field>
                <Field label="City">{text(co.registrationCity)}</Field>
                <Field label="Postal code">{text(co.postalCode)}</Field>
                <Field label="Registered address" wide>{text(co.registrationAddress)}</Field>
                <Field label="Secondary phone">{text(co.secondaryPhone)}</Field>
                <Field label="Licence">{[co.license?.companyName, co.license?.registrationNumber].filter(Boolean).join(' · ') || '—'}</Field>
              </Section>
              <Section title="Authorised person">
                <Field label="Name">{text(rep?.name)}</Field>
                <Field label="Passport">{text(rep?.passport)}</Field>
                <Field label="Nationality">{countryLabel(rep?.nationality)}</Field>
                <Field label="Shareholding">{rep?.shareholdingRatio != null ? `${rep.shareholdingRatio}%` : '—'}</Field>
                <Field label="Email">{text(rep?.email)}</Field>
                <Field label="Phone">{text(rep?.phone)}</Field>
                <Field label="Occupation">{text(rep?.occupation)}</Field>
                <Field label="Residential address" wide>{text(rep?.residentialAddress)}</Field>
              </Section>
              {Array.isArray(co.shareholders) && co.shareholders.length > 0 && (
                <section className="ad-card ad-section">
                  <header>
                    <h2>Shareholders</h2>
                  </header>
                  <div className="ad-table-wrap">
                    <table className="ad-table ad-table-tight">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Passport</th>
                          <th>Nationality</th>
                          <th>Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {co.shareholders.map((s, i) => (
                          <tr key={i}>
                            <td>{text(s.name)}</td>
                            <td>{text(s.passport)}</td>
                            <td>{countryLabel(s.nationality)}</td>
                            <td>{s.ratio != null ? `${s.ratio}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="ad-col ad-col-side">
          <section className="ad-card ad-section">
            <header>
              <h2>Identity verification</h2>
              <p className="ad-muted">Result from Sumsub.</p>
            </header>
            {verification ? (
              <dl className="ad-grid ad-grid-one">
                <Field label="Status">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </Field>
                <Field label="Review">{text(verification.review_status)}</Field>
                <Field label="Answer">{text(verification.review_answer)}</Field>
                {verification.reject_type && <Field label="Rejection type">{text(verification.reject_type)}</Field>}
                {verification.reject_labels.length > 0 && <Field label="Reasons">{verification.reject_labels.join(', ')}</Field>}
                {verification.moderation_comment && <Field label="Reviewer comment" wide>{verification.moderation_comment}</Field>}
                {verification.client_comment && <Field label="Message to client" wide>{verification.client_comment}</Field>}
                <Field label="Level">{text(verification.level_name)}</Field>
                <Field label="Applicant ID">
                  <code>{text(verification.applicant_id)}</code>
                </Field>
                <Field label="Last update">{dateTime(verification.updated_at ?? verification.last_event_at)}</Field>
              </dl>
            ) : (
              <p className="ad-muted">The client has not started the identity check yet.</p>
            )}
          </section>

          {/* the signed copies stored in OSS at submission (src/lib/signedAgreement.js); hidden when there are none */}
          {app.agreements.some((a) => a.file) && (
            <section className="ad-card ad-section">
              <header>
                <h2>Signed agreements</h2>
                <p className="ad-muted">The client’s signed copies. Opens in a new tab.</p>
              </header>
              <ul className="ad-files">
                {app.agreements.map(
                  (a, n) =>
                    a.file && (
                      <li key={n}>
                        <div>
                          <strong>{a.title}</strong>
                          <small>Signed {dateTime(a.acceptedAt ?? app.submittedAt)}</small>
                        </div>
                        <span>
                          <a className="ad-btn ad-btn-small" href={`${ADMIN_HOME}/files/${app.id}?kind=agreement&n=${n}`} target="_blank" rel="noreferrer">
                            View
                          </a>
                          <a className="ad-btn ad-btn-small ad-btn-ghost" href={`${ADMIN_HOME}/files/${app.id}?kind=agreement&n=${n}&download=1`}>
                            Download
                          </a>
                        </span>
                      </li>
                    )
                )}
              </ul>
            </section>
          )}

          <section className="ad-card ad-section">
            <header>
              <h2>Files from the application</h2>
              <p className="ad-muted">Opens in a new tab. Only you can see these.</p>
            </header>
            {files.length === 0 ? (
              <p className="ad-muted">No files.</p>
            ) : (
              <ul className="ad-files">
                {files.map((f) => (
                  <li key={f.id}>
                    <div>
                      <strong>{FILE_LABELS[f.field] ?? docTypeLabel(f.doc_type)}</strong>
                      <small>
                        {f.filename} · {fileSize(f.size)}
                      </small>
                    </div>
                    <span>
                      <a className="ad-btn ad-btn-small" href={`${ADMIN_HOME}/files/${f.id}?kind=form`} target="_blank" rel="noreferrer">
                        View
                      </a>
                      <a className="ad-btn ad-btn-small ad-btn-ghost" href={`${ADMIN_HOME}/files/${f.id}?kind=form&download=1`}>
                        Download
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {documents.length > 0 && (
            <section className="ad-card ad-section">
              <header>
                <h2>Uploaded later by the client</h2>
              </header>
              <ul className="ad-files">
                {documents.map((d) => (
                  <li key={d.id}>
                    <div>
                      <strong>{docTypeLabel(d.doc_type)}</strong>
                      <small>
                        {d.filename} · {fileSize(d.size)} · {dateOnly(d.uploaded_at)} · {text(d.review_status)}
                      </small>
                    </div>
                    <span>
                      <a className="ad-btn ad-btn-small" href={`${ADMIN_HOME}/files/${d.id}?kind=doc`} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="ad-card ad-section">
            <header>
              <h2>Agreements</h2>
              <p className="ad-muted">What the client read and signed.</p>
            </header>
            {app.agreements.length === 0 ? (
              <p className="ad-muted">Nothing recorded.</p>
            ) : (
              <ul className="ad-agreements">
                {app.agreements.map((a, i) => (
                  <li key={i}>
                    <strong>{a.title}</strong>
                    <span className={`ad-tick${a.accepted ? ' is-yes' : ''}`}>{a.accepted ? 'Accepted' : 'Not accepted'}</span>
                    <small>
                      {a.read === undefined ? '' : a.read ? 'Opened and read · ' : 'Not opened · '}
                      {a.acceptedAt ? dateTime(a.acceptedAt) : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}
