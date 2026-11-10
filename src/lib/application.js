// Client application (src/app/apply): the KYC journey from "Current KYC Journey in MAX CRM", with exactly the fields of
// the document: sections 2.1–2.5 for every client, plus a "Contact details" step after 2.1 (email, mobile verified with
// a WhatsApp code, and the ID number), plus 2.6–2.8 (company, business licence, corporate agreement) when the
// client picks the Corporate account type in step 1. 2.2–2.4 are hidden for now (HIDDEN_STEPS): Sumsub collects them. The ID photos (front, back) and the proof of address file are uploaded in
// steps 2 and 3 (actions/application.js → uploadApplicationFile, stored in MySQL application_files); the form keeps their file ids.
// Sumsub still runs after submission (src/app/components/SumsubVerification.jsx).
// Field lists, options and rules shared by the form and the server actions. Pure, so the client form can use it too.
import { countryByCode, isBlockedCountry } from '@/lib/countries';
import { BRAND } from '@/lib/brand';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LETTERS_RE = /^[\p{L}\p{M}\s'’.-]+$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// corporate steps come last, so an individual's steps are the first six of the list
export const STEPS = [
  { key: 'personal', title: 'Personal Information' },
  { key: 'contact', title: 'Contact Details' }, // email + mobile, each verified with a code, and the ID number
  { key: 'identity', title: 'Identity Information' },
  { key: 'address', title: 'Proof of Address' },
  { key: 'questionnaire', title: 'Questionnaire' },
  { key: 'agreement', title: 'Client Agreement' },
  { key: 'company', title: 'Company Information', corporate: true },
  { key: 'license', title: 'Business License', corporate: true },
  { key: 'corporateAgreement', title: 'Client Agreement (Corporate)', corporate: true }
];
/**
 * Steps not shown because Sumsub collects the same thing in its verification after submit (ID document, proof of
 * address, questionnaire). Remove a key to show that step in the form again; its fields and checks are all still here.
 */
export const HIDDEN_STEPS = ['identity', 'address', 'questionnaire'];
export const ACCOUNT_TYPES = ['individual', 'corporate'];
export const isCorporate = (v) => v?.accountType === 'corporate';
/** The steps this client goes through. */
export const stepsFor = (v) => STEPS.filter((s) => !HIDDEN_STEPS.includes(s.key) && (!s.corporate || isCorporate(v)));
export const showsStep = (v, key) => stepsFor(v).some((s) => s.key === key);

// Sumsub idDocType values, in the order of the KYC document
export const ID_TYPES = ['ID_CARD', 'DRIVERS', 'RESIDENCE_PERMIT', 'PASSPORT'];

export const OPTIONS = {
  education: ['Primary School', 'High School', 'Undergraduate', 'Postgraduate', 'Professional Certificate'],
  employment: ['Employed', 'Self-Employed', 'Retired', 'Unemployed', 'Student'],
  industry: [
    'Financial Services',
    'Banking and Insurance',
    'Manufacturing & Construction',
    'Oil, Gas & Energy',
    'Aviation & Aerospace',
    'Retail & Wholesale Trade',
    'Information Technology & Telecom',
    'Hospitality, Tourism & Leisure',
    'Media, Entertainment & Marketing',
    'Healthcare & Pharmaceuticals',
    'Education',
    'Agriculture',
    'Legal, Compliance & Professional Advisory',
    'Auditors & Accounting Services',
    'Real Estate Brokers & Agents',
    'Government & Public Sector',
    'Corporate Services and Company Set Up',
    'Precious Metals & Stones (DPMS)',
    'Defense & Military',
    'Virtual Assets & Web3',
    'Holding Companies & Family Office',
    'Diplomatic Missions & Embassies',
    'Non-Governmental Organizations (NGOs) & Charities',
    'Casino/Gambling',
    'Other'
  ],
  occupation: ['Owner', 'Senior Manager', 'Other'],
  experienceYears: ['0-1 Year', '1-3 Years', '3-5 Years', '5-10 Years', '10+ Years'],
  income: ['0-20K USD', '20K-50K USD', '50K-100K USD', '100K-500K USD', '500K USD-1 Mil USD', '1 Mil+ USD'],
  sourceOfFunds: [
    'Salary Income',
    'Savings / Return on Investments',
    'Inheritance / Gift',
    'Pensions',
    'Third Party',
    'Business Operations (Corporate)'
  ],
  investmentExperience: ['0-1 Year', '1-5 Years', '5-10 Years', '10+ Years'],
  marketExperience: ['None', 'FX', 'Precious Metals', 'Stocks', 'Commodities', 'Indices', 'Futures', 'Crypto CFDs'],
  usCitizen: ['Yes', 'No']
};

export const PEP_TEXT =
  'I declare that I am not a Politically Exposed Person who is or has been entrusted with prominent public function. I also confirm that I have never been convicted of any offence of money laundering, fraud, bribery or corruption or any other criminal offence or subject to ongoing regulatory or legal action(s).';
export const AGREEMENT_TEXT =
  'I confirm that I have carefully read all the terms and conditions of the Risk Acknowledgement And Disclosure, and that the information I have provided is true and accurate. I agree to sign this legally binding contract and accept the associated responsibilities. I understand and agree that this electronic signature is equivalent to a handwritten signature.';

// `…Read`: the client opened that document (src/lib/brand.js gives it a PDF) before signing it
const BOOLEANS = ['pep', 'agreement1', 'agreement2', 'corporateAgreement', 'agreement1Read', 'agreement2Read', 'corporateAgreementRead'];

/** The uploads of the form: field → document type stored with the file (the ID photos use the chosen ID type). */
export const FILE_FIELDS = {
  idFront: { step: 'identity', label: 'front side of your document', side: 'FRONT_SIDE' },
  idBack: { step: 'identity', label: 'back side of your document', side: 'BACK_SIDE' },
  poaFile: { step: 'address', label: 'utility bill or bank statement', docType: 'PROOF_OF_ADDRESS' },
  licenseFile: { step: 'license', label: 'business license', docType: 'BUSINESS_LICENSE' }
};

/** One shareholder (2.6 "Shareholders", optional, repeatable). */
export const EMPTY_SHAREHOLDER = { name: '', passport: '', nationality: '', ratio: '' };
export const MAX_SHAREHOLDERS = 10;
/** A passport has no back side, so its back photo is not asked for. */
export const needsBackSide = (idType) => idType !== 'PASSPORT';

export const EMPTY_APPLICATION = {
  accountType: 'individual', // individual | corporate (corporate adds 2.6–2.8)
  // 2.1 personal information
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  country: '',
  nationality: '',
  partnerCode: '', // from the link (?code, ?ref, …), not shown
  draftId: '', // groups the files uploaded before the application is saved
  // contact details: the mobile is verified with a WhatsApp code (POST /api/send-phone-otp); the e-mail only when it
  // already has an application (the client proves it is theirs and continues with it)
  email: '',
  emailCode: '', // e-mail code (POST /api/otp-smtp)
  emailToken: '', // signed token returned with the e-mail code
  phoneCountry: '', // dialling code of the mobile number, as a country code (starts as the country of residence)
  phone: '', // national number
  phoneCode: '',
  phoneToken: '', // signed token returned with the WhatsApp code (src/lib/otpStore.js), sent back to be checked
  // 2.2 identity information (POI)
  idType: '',
  idFront: '', // uploaded file ids
  idBack: '',
  idFirstName: '',
  idLastName: '',
  idNumber: '',
  // 2.3 proof of address (POA)
  poaFile: '',
  poaCountry: '',
  postalCode: '',
  address: '',
  proofDate: '',
  // 2.4 questionnaire
  education: '',
  employment: '',
  industry: '',
  industryOther: '',
  occupation: '',
  occupationOther: '',
  employer: '',
  previousEmployment: '',
  experienceYears: '',
  income: '',
  sourceOfFunds: '',
  investmentExperience: '',
  marketExperience: '',
  usCitizen: '',
  tin: '',
  pep: false,
  // 2.5 client agreement
  agreement1: false,
  agreement2: false,
  agreement1Read: false,
  agreement2Read: false,
  // 2.6 company information (corporate)
  companyName: '',
  regNumber: '',
  regDate: '',
  regCountry: '',
  regCity: '',
  regPostalCode: '',
  regAddress: '',
  secondaryPhone: '',
  // 2.6 authorised person
  repName: '',
  repPassport: '',
  repNationality: '',
  repRatio: '',
  repAddress: '',
  repEmail: '',
  repPhone: '',
  repOccupation: '',
  shareholders: [], // [{ name, passport, nationality, ratio }]
  // 2.7 business license (corporate)
  licenseCompanyName: '',
  licenseRegNumber: '',
  licenseFile: '',
  // 2.8 client agreement (corporate)
  corporateAgreement: false,
  corporateAgreementRead: false
};

// which step each field belongs to — the form marks a step's fields as touched on "Next"
export const STEP_FIELDS = {
  personal: ['lastName', 'firstName', 'dateOfBirth', 'country', 'nationality'],
  contact: ['email', 'emailCode', 'phoneCountry', 'phone', 'phoneCode', 'idNumber'],
  identity: ['nationality', 'idType', 'idFront', 'idBack', 'idLastName', 'idFirstName', 'idNumber'],
  address: ['poaFile', 'poaCountry', 'postalCode', 'address', 'proofDate'],
  questionnaire: [
    'education', 'employment', 'industry', 'industryOther', 'occupation', 'occupationOther', 'employer', 'previousEmployment',
    'experienceYears', 'income', 'sourceOfFunds', 'investmentExperience', 'marketExperience', 'usCitizen', 'tin', 'pep'
  ],
  agreement: ['agreement1', 'agreement2'],
  company: [
    'companyName', 'regNumber', 'regDate', 'regCountry', 'regCity', 'regPostalCode', 'regAddress', 'secondaryPhone',
    'repName', 'repPassport', 'repNationality', 'repRatio', 'repAddress', 'repEmail', 'repPhone', 'repOccupation', 'shareholders'
  ],
  license: ['licenseCompanyName', 'licenseRegNumber', 'licenseFile'],
  corporateAgreement: ['corporateAgreement']
};

/** Index of the first step that has one of `errors`' fields (-1 when none). */
export const firstStepWithError = (errors) => STEPS.findIndex((s) => STEP_FIELDS[s.key].some((k) => errors[k]));

const LIMITS = { phoneToken: 2000, emailToken: 2000, regAddress: 300, repAddress: 300, address: 300, idNumber: 40, postalCode: 20, tin: 40, employer: 120, previousEmployment: 120, industryOther: 120, occupationOther: 120 };

/** Trimmed copy of the values (from a plain object or FormData). */
export function readApplication(src) {
  const get = (k) => (typeof src?.get === 'function' ? src.get(k) : src?.[k]);
  const out = {};
  for (const k of Object.keys(EMPTY_APPLICATION)) {
    const raw = get(k);
    if (k === 'shareholders') out[k] = readShareholders(raw);
    else if (BOOLEANS.includes(k)) out[k] = raw === true || raw === 'true' || raw === 'on';
    else out[k] = String(raw ?? '').trim().slice(0, LIMITS[k] ?? 160);
  }
  for (const k of ['country', 'nationality', 'phoneCountry', 'poaCountry', 'regCountry', 'repNationality']) out[k] = out[k].slice(0, 2).toUpperCase();
  out.email = out.email.toLowerCase();
  out.phone = out.phone.replace(/\D/g, '').replace(/^0+/, ''); // national number without a leading trunk 0
  out.phoneCode = out.phoneCode.replace(/\D/g, '').slice(0, 6);
  out.emailCode = out.emailCode.replace(/\D/g, '').slice(0, 6);
  if (!ACCOUNT_TYPES.includes(out.accountType)) out.accountType = 'individual';
  for (const k of ['secondaryPhone', 'repPhone']) out[k] = out[k].replace(/[^\d+\s-]/g, '');
  out.repEmail = out.repEmail.toLowerCase();
  return out;
}

function readShareholders(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SHAREHOLDERS).map((x) => ({
    name: String(x?.name ?? '').trim().slice(0, 120),
    passport: String(x?.passport ?? '').trim().slice(0, 40),
    nationality: String(x?.nationality ?? '').trim().slice(0, 2).toUpperCase(),
    ratio: String(x?.ratio ?? '').trim().slice(0, 6)
  }));
}

const PHONE_RE = /^\+?[\d\s-]{6,20}$/;
const ratioError = (r) => {
  const n = Number(r);
  if (r === '' || !Number.isFinite(n)) return 'Enter the shareholding ratio in %.';
  if (n <= 0 || n > 100) return 'Use a value between 0 and 100.';
};

export function emailError(email) {
  if (!email.trim()) return 'Please enter your email address.';
  if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
}

const today = () => new Date().toISOString().slice(0, 10);
function ageOn(dob) {
  const d = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

const need = (e, v, k, msg) => {
  if (!v[k]) e[k] = msg;
};
const oneOf = (e, v, k, list, msg) => {
  if (!list.includes(v[k])) e[k] = msg;
};

const READ_FIRST = 'Please open and read the document before signing it.';

/** Message when a residence / nationality / registration country is missing or one we can't accept; undefined when fine. */
const countryError = (code, missing) => {
  if (!countryByCode(code)) return missing;
  if (isBlockedCountry(code)) return `Sorry, we can't accept applications for ${countryByCode(code).name} at the moment.`;
};

/** Field → message for one step's invalid fields. Uploads count as given once the form holds their file id. */
export function validateStep(key, v) {
  const e = {};
  if (key === 'personal') {
    if (!v.firstName.trim()) e.firstName = 'Please enter your given name.';
    else if (!LETTERS_RE.test(v.firstName.trim())) e.firstName = 'Use letters only.';
    if (!v.lastName.trim()) e.lastName = 'Please enter your surname.';
    else if (!LETTERS_RE.test(v.lastName.trim())) e.lastName = 'Use letters only.';
    if (!DATE_RE.test(v.dateOfBirth)) e.dateOfBirth = 'Please enter your date of birth.';
    else if (v.dateOfBirth > today()) e.dateOfBirth = 'Date of birth cannot be in the future.';
    else if (ageOn(v.dateOfBirth) < 18) e.dateOfBirth = 'You must be at least 18 years old.';
    else if (ageOn(v.dateOfBirth) > 120) e.dateOfBirth = 'Please check your date of birth.';
    { const m = countryError(v.country, 'Please choose your country of residence.'); if (m) e.country = m; }
    { const m = countryError(v.nationality, 'Please choose your nationality.'); if (m) e.nationality = m; }
  }
  if (key === 'contact') {
    const mail = emailError(v.email);
    if (mail) e.email = mail;
    // e-mail code: only asked for when the e-mail already has an application, which the server checks (actions/application.js)
    if (!countryByCode(v.phoneCountry)) e.phoneCountry = 'Choose the country code.';
    const digits = v.phone.replace(/\D/g, '');
    if (!digits) e.phone = 'Please enter your mobile number.';
    else if (digits.length < 5 || digits.length > 14) e.phone = 'Please enter a valid mobile number.';
    if (!v.phoneToken) e.phoneCode = 'Send the code to your WhatsApp first.';
    else if (!/^\d{6}$/.test(v.phoneCode)) e.phoneCode = v.phoneCode ? 'The code has 6 digits.' : 'Enter the 6-digit code we sent on WhatsApp.';
    if (!v.idNumber.trim()) e.idNumber = 'Please enter your ID number.';
    else if (!/^[A-Za-z0-9 -]{3,40}$/.test(v.idNumber.trim())) e.idNumber = 'Use letters, numbers and dashes only.';
  }
  if (key === 'identity') {
    { const m = countryError(v.nationality, 'Please choose your nationality.'); if (m) e.nationality = m; }
    oneOf(e, v, 'idType', ID_TYPES, 'Please choose your identification document.');
    if (!v.idFront) e.idFront = 'Please upload a photo of the front side.';
    if (needsBackSide(v.idType) && !v.idBack) e.idBack = 'Please upload a photo of the back side.';
    if (!v.idLastName.trim()) e.idLastName = 'Enter the surname as shown on the document.';
    else if (!LETTERS_RE.test(v.idLastName.trim())) e.idLastName = 'Use letters only.';
    if (!v.idFirstName.trim()) e.idFirstName = 'Enter the given name as shown on the document.';
    else if (!LETTERS_RE.test(v.idFirstName.trim())) e.idFirstName = 'Use letters only.';
    if (!v.idNumber.trim()) e.idNumber = 'Please enter the document number.';
    else if (!/^[A-Za-z0-9 -]{3,40}$/.test(v.idNumber.trim())) e.idNumber = 'Use letters, numbers and dashes only.';
  }
  if (key === 'address') {
    if (!v.poaFile) e.poaFile = 'Please upload a recent utility bill or bank statement.';
    { const m = countryError(v.poaCountry, 'Please choose your country of residence.'); if (m) e.poaCountry = m; }
    if (!v.postalCode.trim()) e.postalCode = 'Please enter your postal code.';
    else if (!/^[A-Za-z0-9 -]{2,20}$/.test(v.postalCode.trim())) e.postalCode = 'Please enter a valid postal code.';
    if (v.address.trim().length < 10) e.address = 'Please enter your full address (building, street, city).';
    if (v.proofDate && (!DATE_RE.test(v.proofDate) || v.proofDate > today())) e.proofDate = 'The date cannot be in the future.';
  }
  if (key === 'questionnaire') {
    oneOf(e, v, 'education', OPTIONS.education, 'Please choose your educational level.');
    oneOf(e, v, 'employment', OPTIONS.employment, 'Please choose your employment status.');
    oneOf(e, v, 'industry', OPTIONS.industry, 'Please choose your industry.');
    if (v.industry === 'Other') need(e, v, 'industryOther', 'Please describe your industry.');
    oneOf(e, v, 'occupation', OPTIONS.occupation, 'Please choose your occupation.');
    if (v.occupation === 'Other') need(e, v, 'occupationOther', 'Please enter your job title.');
    oneOf(e, v, 'experienceYears', OPTIONS.experienceYears, 'Please choose your years of working experience.');
    oneOf(e, v, 'income', OPTIONS.income, 'Please choose your estimated annual income.');
    oneOf(e, v, 'sourceOfFunds', OPTIONS.sourceOfFunds, 'Please choose the source of your funds.');
    oneOf(e, v, 'investmentExperience', OPTIONS.investmentExperience, 'Please choose your investment experience.');
    oneOf(e, v, 'marketExperience', OPTIONS.marketExperience, 'Please choose your market investment experience.');
    oneOf(e, v, 'usCitizen', OPTIONS.usCitizen, 'Please tell us whether you are a US citizen.');
    if (!v.pep) e.pep = 'Please confirm the declaration to continue.';
  }
  if (key === 'agreement') {
    if (!v.agreement1) e.agreement1 = 'Please confirm to sign the agreement.';
    else if (BRAND.agreements[0]?.url && !v.agreement1Read) e.agreement1 = READ_FIRST;
    if (!v.agreement2) e.agreement2 = 'Please confirm to sign the agreement.';
    else if (BRAND.agreements[1]?.url && !v.agreement2Read) e.agreement2 = READ_FIRST;
  }
  if (key === 'company') {
    need(e, v, 'companyName', 'Please enter the company name.');
    need(e, v, 'regNumber', 'Please enter the registration number.');
    if (!DATE_RE.test(v.regDate)) e.regDate = 'Please enter the registration date.';
    else if (v.regDate > today()) e.regDate = 'The date cannot be in the future.';
    { const m = countryError(v.regCountry, 'Please choose the registration country.'); if (m) e.regCountry = m; }
    need(e, v, 'regCity', 'Please enter the registration city.');
    if (!v.regPostalCode.trim()) e.regPostalCode = 'Please enter the postal code.';
    else if (!/^[A-Za-z0-9 -]{2,20}$/.test(v.regPostalCode.trim())) e.regPostalCode = 'Please enter a valid postal code.';
    if (v.regAddress.trim().length < 10) e.regAddress = 'Please enter the full registration address.';
    if (v.secondaryPhone && !PHONE_RE.test(v.secondaryPhone)) e.secondaryPhone = 'Please enter a valid phone number.';
    if (!v.repName.trim()) e.repName = 'Please enter the name.';
    else if (!LETTERS_RE.test(v.repName.trim())) e.repName = 'Use letters only.';
    if (!/^[A-Za-z0-9 -]{3,40}$/.test(v.repPassport.trim())) e.repPassport = 'Please enter the passport number.';
    { const m = countryError(v.repNationality, 'Please choose the nationality.'); if (m) e.repNationality = m; }
    const ratio = ratioError(v.repRatio);
    if (ratio) e.repRatio = ratio;
    if (v.repAddress.trim().length < 10) e.repAddress = 'Please enter the full residential address.';
    const mail = emailError(v.repEmail);
    if (mail) e.repEmail = mail;
    if (!v.repPhone) e.repPhone = 'Please enter the phone number.';
    else if (!PHONE_RE.test(v.repPhone)) e.repPhone = 'Please enter a valid phone number.';
    need(e, v, 'repOccupation', 'Please enter the occupation.');
    const bad = (v.shareholders ?? []).some((x) => !x.name || !x.passport || countryError(x.nationality, 'x') || ratioError(x.ratio));
    if (bad) e.shareholders = 'Complete every shareholder (name, passport, nationality and ratio) or remove it.';
    else {
      const total = Number(v.repRatio || 0) + (v.shareholders ?? []).reduce((n, x) => n + Number(x.ratio || 0), 0);
      if (total > 100) e.shareholders = 'The shareholding ratios add up to more than 100%.';
    }
  }
  if (key === 'license') {
    need(e, v, 'licenseCompanyName', 'Please enter the company name.');
    need(e, v, 'licenseRegNumber', 'Please enter the registration number.');
    if (!v.licenseFile) e.licenseFile = 'Please upload the business license.';
  }
  if (key === 'corporateAgreement') {
    if (!v.corporateAgreement) e.corporateAgreement = 'Please confirm to sign the agreement.';
    else if (BRAND.corporateAgreement?.url && !v.corporateAgreementRead) e.corporateAgreement = READ_FIRST;
  }
  return e;
}

/** Errors of every step this client goes through (corporate steps only for a corporate client). */
export function validateAll(v) {
  return Object.assign({}, ...stepsFor(v).map((s) => validateStep(s.key, v)));
}

/** The phone number in international form, e.g. "+971 501234567". */
export function fullPhone(countryCode, phone) {
  const dial = countryByCode(countryCode)?.dial;
  return dial ? `+${dial} ${phone.replace(/\D/g, '')}` : phone;
}

/** The mobile number as WhatsApp / E.164 wants it, e.g. "+971501234567" (empty when the country code is unknown). */
export function e164(countryCode, phone) {
  const dial = countryByCode(countryCode)?.dial;
  return dial ? `+${dial}${String(phone ?? '').replace(/\D/g, '').replace(/^0+/, '')}` : '';
}
