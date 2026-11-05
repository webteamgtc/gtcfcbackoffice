// Who the portal belongs to. GTC Financial Consultancy L.L.C (CAT 5): consultancy and introduction only,
// so no trading wording anywhere in the portal (trade, CFDs, leverage, spreads, "open account", broker).
export const BRAND = {
  name: 'GTC Financial Consultancy',
  legalName: 'GTC Financial Consultancy L.L.C',
  // set the client support address here once it is confirmed; the portal hides the e-mail link while it is empty
  supportEmail: '',
  // the two documents the client signs in the application's last step (src/app/apply). With a `url` (a PDF), the
  // document is shown in a scrollable viewer above its checkbox, with a link to open it; without one, only the checkbox.
  agreements: [
    { title: 'Client Agreement', url: '' },
    { title: 'Risk Acknowledgement and Disclosure', url: '' }
  ]
};
