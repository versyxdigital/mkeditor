const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

const registrationSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/),
  clientValue: z.string().trim().min(1).max(512),
});

/** Inject the Desktop registration into build output, never into tracked source. */
function writeGoogleDriveRegistration({
  root = path.resolve(__dirname, '..'),
  env = process.env,
} = {}) {
  let registration = null;
  if (env.MKEDITOR_GOOGLE_CLIENT_ID || env.MKEDITOR_GOOGLE_CLIENT_SECRET) {
    registration = {
      clientId: env.MKEDITOR_GOOGLE_CLIENT_ID,
      clientValue: env.MKEDITOR_GOOGLE_CLIENT_SECRET,
    };
  } else {
    try {
      registration = JSON.parse(
        fs.readFileSync(
          path.join(root, 'src/app/config/googleDrive.local.json'),
          'utf8',
        ),
      );
      if (registration === null) throw new Error('Invalid registration');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error('Cannot read Google Drive local registration.');
      }
    }
  }

  let output = { clientId: '', clientValue: '' };
  if (registration !== null) {
    const parsed = registrationSchema.safeParse(registration);
    if (!parsed.success) {
      throw new Error(
        'Invalid Google Drive registration: provide both a Desktop client ID and client secret.',
      );
    }
    output = parsed.data;
  } else if (env.MKEDITOR_REQUIRE_GOOGLE_DRIVE === 'true') {
    throw new Error(
      'Google Drive registration is required for release builds.',
    );
  }

  const target = path.join(root, 'dist/app/config/googleDrive.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
  return registration !== null;
}

module.exports = { writeGoogleDriveRegistration };
