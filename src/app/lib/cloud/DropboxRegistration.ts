import { z } from 'zod';
import bundled from '../../config/dropbox.json';
import type { CloudRegistration } from './CloudProvider';

export const DROPBOX_CALLBACK_PORT = 53683;
export const DROPBOX_REDIRECT_URI = `http://127.0.0.1:${DROPBOX_CALLBACK_PORT}/oauth/callback`;
export const dropboxRegistrationSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{4,100}$/),
  clientValue: z.literal('').default(''),
});
const parsed = dropboxRegistrationSchema.safeParse(bundled);
export const dropboxRegistration: Readonly<CloudRegistration> | null =
  parsed.success ? parsed.data : null;
