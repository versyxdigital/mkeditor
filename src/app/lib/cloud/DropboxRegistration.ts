import bundled from '../../config/dropbox.json';
import type { CloudRegistration } from './CloudProvider';

export const DROPBOX_CALLBACK_PORT = 53683;
export const DROPBOX_REDIRECT_URI = `http://127.0.0.1:${DROPBOX_CALLBACK_PORT}/oauth/callback`;
export { dropboxRegistrationSchema } from './CloudRegistration';
import { dropboxRegistrationSchema } from './CloudRegistration';
const parsed = dropboxRegistrationSchema.safeParse(bundled);
export const dropboxRegistration: Readonly<CloudRegistration> | null =
  parsed.success ? parsed.data : null;
