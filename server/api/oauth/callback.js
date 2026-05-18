export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // state carries the extension's *.chromiumapp.org redirect URL so the server
  // doesn't need to know the extension ID — it's passed in at runtime.
  let extensionRedirect;
  try {
    extensionRedirect = decodeURIComponent(state ?? '');
    if (!extensionRedirect.match(/^https:\/\/[a-z]{32}\.chromiumapp\.org\//)) {
      throw new Error('invalid state');
    }
  } catch {
    return res.status(400).send('Invalid state parameter');
  }

  if (error) {
    return res.redirect(302, `${extensionRedirect}?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(302, `${extensionRedirect}?error=missing_code`);
  }

  const serverUrl = process.env.SERVER_URL ?? `https://${req.headers.host}`;
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${serverUrl}/api/oauth/callback`,
    }),
  });

  const data = await tokenRes.json();

  if (!data.ok) {
    return res.redirect(302, `${extensionRedirect}?error=${encodeURIComponent(data.error)}`);
  }

  // Remove ALLOWED_TEAM_ID from Vercel env vars to open up to any workspace.
  if (process.env.ALLOWED_TEAM_ID && data.team?.id !== process.env.ALLOWED_TEAM_ID) {
    return res.redirect(302, `${extensionRedirect}?error=wrong_workspace`);
  }

  const token = data.authed_user?.access_token;
  const team = data.team?.name ?? '';

  return res.redirect(
    302,
    `${extensionRedirect}?token=${encodeURIComponent(token)}&team=${encodeURIComponent(team)}`,
  );
}
