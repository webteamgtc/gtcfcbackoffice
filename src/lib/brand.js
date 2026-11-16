// Who the portal belongs to. GTC Financial Consultancy L.L.C (CAT 5): consultancy and introduction only,
// so no trading wording anywhere in the portal (trade, CFDs, leverage, spreads, "open account", broker).
export const BRAND = {
  name: 'GTC Financial Consultancy',
  legalName: 'GTC Financial Consultancy L.L.C',
  // set the client support address here once it is confirmed; the portal hides the e-mail link while it is empty
  supportEmail: '',
  // the documents the client signs in the application's agreement step (src/app/apply). With a `url` (a PDF: a full
  // https link, or a file in public/ such as '/docs/client-agreement.pdf'), the card gets a Read button that opens it.
  // `declaration`: the text of its checkbox (default AGREEMENT_TEXT in src/lib/application.js)
  agreements: [
    {
      title: 'Client Agreement',
      url: '/client-agreement.pdf', // public/client-agreement.pdf
      declaration:
        'I confirm that I have carefully read all the Client Terms of Business, and understand that GTC Financial Consultancy LLC acts solely as an introducing entity, facilitating my introduction to the relevant Service Provider, and is not the provider of the financial products or services offered. I understand that my contractual relationship for such products and services will be directly with the Service Provider. I agree to sign this legally binding contract and accept the associated responsibilities. I understand and agree that this electronic signature is equivalent to a handwritten signature.'
    },
    { title: 'Risk Acknowledgement and Disclosure', url: '' }
  ],
  // signed by corporate clients in their last step (2.8)
  corporateAgreement: { title: 'Client Agreement (Corporate)', url: '' }
};
