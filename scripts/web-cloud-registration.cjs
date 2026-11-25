/** Web OAuth uses public identifiers only and never reads desktop registration files. */
function webCloudRegistration(env = process.env) {
  const googleClientId = (env.MKEDITOR_WEB_GOOGLE_CLIENT_ID || '').trim();
  const dropboxAppKey = (env.MKEDITOR_WEB_DROPBOX_APP_KEY || '').trim();
  if (
    googleClientId &&
    !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleClientId)
  )
    throw new Error('Invalid Google web OAuth client ID.');
  if (dropboxAppKey && !/^[a-zA-Z0-9_-]{4,100}$/.test(dropboxAppKey))
    throw new Error('Invalid Dropbox web app key.');
  if (env.MKEDITOR_REQUIRE_WEB_CLOUD === 'true') {
    if (!googleClientId)
      throw new Error(
        'MKEDITOR_WEB_GOOGLE_CLIENT_ID is required for this web build.',
      );
    if (!dropboxAppKey)
      throw new Error(
        'MKEDITOR_WEB_DROPBOX_APP_KEY is required for this web build.',
      );
  }
  return { googleClientId, dropboxAppKey };
}

module.exports = { webCloudRegistration };
