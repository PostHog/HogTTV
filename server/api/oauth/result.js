// Landing page for the finished OAuth flow. The extension opens auth in a normal
// tab, watches for it to reach this URL, reads the token from the query, and
// closes the tab — usually before this page is even seen. This exists as a
// friendly fallback in case that auto-close lags, and it strips the token from
// the address bar immediately so it isn't left sitting in the URL/history.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default function handler(req, res) {
  const { team, error } = req.query;

  const heading = error
    ? (error === 'wrong_workspace' ? 'This workspace is not authorized' : 'Connection failed')
    : `Connected to ${escapeHtml(team || 'your workspace')}`;
  const detail = error
    ? 'You can close this tab and try again from the extension.'
    : 'You can close this tab — your emojis are syncing now.';
  const mark = error ? '⚠️' : '✓';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HogTTV — Slack</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #f8f8fb; color: #1d1c1d; }
    .card { text-align: center; padding: 40px 48px; background: #fff; border-radius: 16px;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 360px; }
    .mark { font-size: 40px; line-height: 1; }
    h1 { font-size: 20px; margin: 16px 0 8px; }
    p { margin: 0; color: #616061; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="mark">${mark}</div>
    <h1>${heading}</h1>
    <p>${detail}</p>
  </div>
  <script>
    // Strip the token (and the rest of the query) from the visible URL so it
    // isn't left in the address bar or browser history.
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  </script>
</body>
</html>`);
}
