// Client application (src/app/apply): the KYC journey from "Current KYC Journey in MAX CRM", with exactly the fields of
// the document: sections 2.1–2.5 for every client, plus 2.6–2.8 (company, business licence, corporate agreement) when the
// client picks the Corporate account type in step 1. The ID photos (front, back) and the proof of address file are uploaded in
// steps 2 and 3 (actions/application.js → uploadApplicationFile, stored in GridFS); the form keeps their file ids.
// Sumsub still runs after submission (src/app/components/SumsubVerification.jsx).
// Field lists, options and rules shared by the form and the server actions. Pure, so the client form can use it too.
import { countryByCode } from '@/lib/countries';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LETTERS_RE = /^[\p{L}\p{M}\s'’.-]+$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// corporate steps come last, so an individual's steps are the first five of the list
export const STEPS = [
  { key: 'personal', title: 'Personal Information' },
  { key: 'identity', title: 'Identity Information' },
  { key: 'address', title: 'Proof of Address' },
  { key: 'questionnaire', title: 'Questionnaire' },
  { key: 'agreement', title: 'Client Agreement' },
  { key: 'company', title: 'Company Information', corporate: true },
  { key: 'license', title: 'Business License', corporate: true },
  { key: 'corporateAgreement', title: 'Client Agreement (Corporate)', corporate: true }
];
export const ACCOUNT_TYPES = ['individual', 'corporate'];
export const isCorporate = (v) => v?.accountType === 'corporate';
/** The steps this client goes through. */
export const stepsFor = (v) => STEPS.filter((s) => !s.corporate || isCorporate(v));

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

const BOOLEANS = ['pep', 'agreement1', 'agreement2', 'corporateAgreement'];

/** The uploads of the form: field → document type stored with the file (the ID photos use the chosen ID type). */
export const FILE_FIELDS = {
  idFront: { label: 'front side of your document', side: 'FRONT_SIDE' },
  idBack: { label: 'back side of your document', side: 'BACK_SIDE' },
  poaFile: { label: 'utility bill or bank statement', docType: 'PROOF_OF_ADDRESS' },
  licenseFile: { label: 'business license', docType: 'BUSINESS_LICENSE', corporate: true }
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
  corporateAgreement: false
};

// which step each field belongs to — the form marks a step's fields as touched on "Next"
export const STEP_FIELDS = {
  personal: ['lastName', 'firstName', 'dateOfBirth', 'country', 'nationality'],
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

const LIMITS = { regAddress: 300, repAddress: 300, address: 300, idNumber: 40, postalCode: 20, tin: 40, employer: 120, previousEmployment: 120, industryOther: 120, occupationOther: 120 };

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
  for (const k of ['country', 'nationality', 'poaCountry', 'regCountry', 'repNationality']) out[k] = out[k].slice(0, 2).toUpperCase();
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
    if (!countryByCode(v.country)) e.country = 'Please choose your country of residence.';
    if (!countryByCode(v.nationality)) e.nationality = 'Please choose your nationality.';
  }
  if (key === 'identity') {
    if (!countryByCode(v.nationality)) e.nationality = 'Please choose your nationality.';
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
    if (!countryByCode(v.poaCountry)) e.poaCountry = 'Please choose your country of residence.';
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
    if (!v.agreement2) e.agreement2 = 'Please confirm to sign the agreement.';
  }
  if (key === 'company') {
    need(e, v, 'companyName', 'Please enter the company name.');
    need(e, v, 'regNumber', 'Please enter the registration number.');
    if (!DATE_RE.test(v.regDate)) e.regDate = 'Please enter the registration date.';
    else if (v.regDate > today()) e.regDate = 'The date cannot be in the future.';
    if (!countryByCode(v.regCountry)) e.regCountry = 'Please choose the registration country.';
    need(e, v, 'regCity', 'Please enter the registration city.');
    if (!v.regPostalCode.trim()) e.regPostalCode = 'Please enter the postal code.';
    else if (!/^[A-Za-z0-9 -]{2,20}$/.test(v.regPostalCode.trim())) e.regPostalCode = 'Please enter a valid postal code.';
    if (v.regAddress.trim().length < 10) e.regAddress = 'Please enter the full registration address.';
    if (v.secondaryPhone && !PHONE_RE.test(v.secondaryPhone)) e.secondaryPhone = 'Please enter a valid phone number.';
    if (!v.repName.trim()) e.repName = 'Please enter the name.';
    else if (!LETTERS_RE.test(v.repName.trim())) e.repName = 'Use letters only.';
    if (!/^[A-Za-z0-9 -]{3,40}$/.test(v.repPassport.trim())) e.repPassport = 'Please enter the passport number.';
    if (!countryByCode(v.repNationality)) e.repNationality = 'Please choose the nationality.';
    const ratio = ratioError(v.repRatio);
    if (ratio) e.repRatio = ratio;
    if (v.repAddress.trim().length < 10) e.repAddress = 'Please enter the full residential address.';
    const mail = emailError(v.repEmail);
    if (mail) e.repEmail = mail;
    if (!v.repPhone) e.repPhone = 'Please enter the phone number.';
    else if (!PHONE_RE.test(v.repPhone)) e.repPhone = 'Please enter a valid phone number.';
    need(e, v, 'repOccupation', 'Please enter the occupation.');
    const bad = (v.shareholders ?? []).some((x) => !x.name || !x.passport || !countryByCode(x.nationality) || ratioError(x.ratio));
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
