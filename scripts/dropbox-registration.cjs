const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const schema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{4,100}$/),
  clientValue: z.literal('').default(''),
});
function writeDropboxRegistration({
  root = path.resolve(__dirname, '..'),
  env = process.env,
} = {}) {
  let registration = null;
  if (env.MKEDITOR_DROPBOX_APP_KEY)
    registration = { clientId: env.MKEDITOR_DROPBOX_APP_KEY, clientValue: '' };
  else {
    try {
      registration = JSON.parse(
        fs.readFileSync(
          path.join(root, 'src/app/config/dropbox.local.json'),
          'utf8',
        ),
      );
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Cannot read Dropbox local registration.');
    }
  }
  let output = { clientId: '', clientValue: '' };
  if (registration !== null) {
    const parsed = schema.safeParse(registration);
    if (!parsed.success)
      throw new Error(
        'Invalid Dropbox app key. Dropbox PKCE does not use an app secret.',
      );
    output = parsed.data;
  } else if (env.MKEDITOR_REQUIRE_DROPBOX === 'true')
    throw new Error('Dropbox registration is required for this build.');
  const target = path.join(root, 'dist/app/config/dropbox.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  return registration !== null;
}
module.exports = { writeDropboxRegistration };
