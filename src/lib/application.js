// Client application (src/app/apply): the personal KYC journey from "Current KYC Journey in MAX CRM" (sections 2.1–2.5),
// with the account details (email + code, password, phone) added to step 1 since clients register here.
// The document photos and the proof of address file are not uploaded here: Sumsub collects them (and the selfie) after
// submission (src/app/components/SumsubVerification.jsx).
// Field lists, options and rules shared by the form and the server actions. Pure, so the client form can use it too.
import { countryByCode } from '@/lib/countries';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LETTERS_RE = /^[\p{L}\p{M}\s'’.-]+$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const STEPS = [
  { key: 'personal', title: 'Personal Information' },
  { key: 'identity', title: 'Identity Information' },
  { key: 'address', title: 'Proof of Address' },
  { key: 'questionnaire', title: 'Questionnaire' },
  { key: 'agreement', title: 'Client Agreement' }
];

// Sumsub idDocType values, in the order of the KYC document
export const ID_TYPES = ['ID_CARD', 'DRIVERS', 'RESIDENCE_PERMIT', 'PASSPORT'];

export const OPTIONS = {
  education: ['Primary School', 'High School', 'Undergraduate', 'Postgraduate', 'Professional Certificate'],
  employment: ['Employed', 'Self-Employed', 'Retired', 'Student'],
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
  income: ['0-20K USD', '20K-50K USD', '50K-100K USD', '100K-500K USD', '500K-1M USD', '1M+ USD'],
  sourceOfFunds: [
    'Salary Income',
    'Savings / Return on Investments',
    'Inheritance / Gift',
    'Pensions',
    'Third Party'
  ],
  investmentExperience: ['0-1 Year', '1-5 Years', '5-10 Years', '10+ Years'],
  marketExperience: ['None', 'FX', 'Precious Metals', 'Stocks', 'Commodities', 'Indices', 'Futures', 'Crypto CFDs'],
  usCitizen: ['Yes', 'No']
};

export const PEP_TEXT =
  'I declare that I am not a Politically Exposed Person who is or has been entrusted with prominent public function. I also confirm that I have never been convicted of any offence of money laundering, fraud, bribery or corruption or any other criminal offence or subject to ongoing regulatory or legal action(s).';
export const AGREEMENT_TEXT =
  'I confirm that I have carefully read all the terms and conditions of the Risk Acknowledgement And Disclosure, and that the information I have provided is true and accurate. I agree to sign this legally binding contract and accept the associated responsibilities. I understand and agree that this electronic signature is equivalent to a handwritten signature.';

const BOOLEANS = ['pep', 'agreement1', 'agreement2'];

export const EMPTY_APPLICATION = {
  // 2.1 personal information (+ account)
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  country: '',
  email: '',
  code: '',
  password: '',
  phone: '',
  partnerCode: '',
  // 2.2 identity information (POI)
  nationality: '',
  idType: '',
  idFirstName: '',
  idLastName: '',
  idNumber: '',
  // 2.3 proof of address (POA)
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
  agreement2: false
};

// which step each field belongs to — the form marks a step's fields as touched on "Next"
export const STEP_FIELDS = {
  personal: ['firstName', 'lastName', 'dateOfBirth', 'country', 'email', 'code', 'password', 'phone', 'partnerCode'],
  identity: ['nationality', 'idType', 'idFirstName', 'idLastName', 'idNumber'],
  address: ['poaCountry', 'postalCode', 'address', 'proofDate'],
  questionnaire: [
    'education', 'employment', 'industry', 'industryOther', 'occupation', 'occupationOther', 'employer', 'previousEmployment',
    'experienceYears', 'income', 'sourceOfFunds', 'investmentExperience', 'marketExperience', 'usCitizen', 'tin', 'pep'
  ],
  agreement: ['agreement1', 'agreement2']
};

/** Index of the first step that has one of `errors`' fields (-1 when none). */
export const firstStepWithError = (errors) => STEPS.findIndex((s) => STEP_FIELDS[s.key].some((k) => errors[k]));

const LIMITS = { address: 300, idNumber: 40, postalCode: 20, tin: 40, employer: 120, previousEmployment: 120, industryOther: 120, occupationOther: 120 };

/** Trimmed copy of the values (from a plain object or FormData). */
export function readApplication(src) {
  const get = (k) => (typeof src?.get === 'function' ? src.get(k) : src?.[k]);
  const out = {};
  for (const k of Object.keys(EMPTY_APPLICATION)) {
    const raw = get(k);
    if (BOOLEANS.includes(k)) out[k] = raw === true || raw === 'true' || raw === 'on';
    else out[k] = String(raw ?? '').trim().slice(0, LIMITS[k] ?? 160);
  }
  out.email = out.email.toLowerCase();
  out.password = String(get('password') ?? '').slice(0, 128);
  out.phone = out.phone.replace(/\D/g, '');
  for (const k of ['country', 'nationality', 'poaCountry']) out[k] = out[k].slice(0, 2).toUpperCase();
  return out;
}

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

/** Field → message for one step's invalid fields. (The documents themselves are collected by Sumsub after submission.) */
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
    const mail = emailError(v.email);
    if (mail) e.email = mail;
    if (!v.code) e.code = 'Enter the 6-digit code we emailed you.';
    else if (!/^\d{6}$/.test(v.code)) e.code = 'The code has 6 digits.';
    if (!v.password) e.password = 'Please choose a password.';
    else if (v.password.length < 8) e.password = 'Use at least 8 characters.';
    else if (!/^(?=.*[A-Za-z])(?=.*\d)/.test(v.password)) e.password = 'Use at least one letter and one number.';
    const digits = v.phone.replace(/\D/g, '');
    if (!digits) e.phone = 'Please enter your phone number.';
    else if (digits.length < 5 || digits.length > 14) e.phone = 'Please enter a valid phone number.';
  }
  if (key === 'identity') {
    if (!countryByCode(v.nationality)) e.nationality = 'Please choose your nationality.';
    oneOf(e, v, 'idType', ID_TYPES, 'Please choose your identification document.');
    if (!v.idLastName.trim()) e.idLastName = 'Enter the surname as shown on the document.';
    else if (!LETTERS_RE.test(v.idLastName.trim())) e.idLastName = 'Use letters only.';
    if (!v.idFirstName.trim()) e.idFirstName = 'Enter the given name as shown on the document.';
    else if (!LETTERS_RE.test(v.idFirstName.trim())) e.idFirstName = 'Use letters only.';
    if (!v.idNumber.trim()) e.idNumber = 'Please enter the document number.';
    else if (!/^[A-Za-z0-9 -]{3,40}$/.test(v.idNumber.trim())) e.idNumber = 'Use letters, numbers and dashes only.';
  }
  if (key === 'address') {
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
  return e;
}

export function validateAll(v) {
  return Object.assign({}, ...STEPS.map((s) => validateStep(s.key, v)));
}

/** The phone number in international form, e.g. "+971 501234567". */
export function fullPhone(countryCode, phone) {
  const dial = countryByCode(countryCode)?.dial;
  return dial ? `+${dial} ${phone.replace(/\D/g, '')}` : phone;
}
