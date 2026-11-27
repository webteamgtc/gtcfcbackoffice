/**
 * Where Shufti Pro sends the browser when the client has finished (redirect_url, src/lib/verification.js). Usually that
 * is inside the iframe on the client's page (src/app/components/ShuftiVerification.jsx): this tells that page to look up
 * the result now. Opened in its own tab, it tells the page that opened it, and offers the way back. Nothing is read from
 * the query string: the result always comes from Shufti itself (status endpoint / callback).
 */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verification submitted</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2a4f; background: #fff; }
  main { max-width: 420px; padding: 32px 20px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 16px; color: #5b6479; }
  a { color: #29408f; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Thank you</h1>
  <p>Your documents have been submitted. We're checking them now; this usually takes less than a minute.</p>
  <p id="back" hidden><a href="/">Back to your application</a></p>
</main>
<script>
  (function () {
    var msg = { type: 'shufti:done' };
    var target = window.parent !== window ? window.parent : window.opener;
    if (target) {
      try { target.postMessage(msg, window.location.origin); } catch (e) {}
    }
    if (window.parent === window) document.getElementById('back').hidden = false;
  })();
</script>
</body>
</html>`;

export function GET() {
  return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
