// Feature switches. Plain constants so src/proxy.js can import them too.

// false: the site only shows the client application form (src/app/apply) at "/"; the sign-in page and
// dashboard stay in the code but every route leads back to the form. Set to true to bring the portal back.
export const PORTAL_LOGIN_ENABLED = false;
