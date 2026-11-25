import { z } from 'zod';
import bundled from '../../config/googleDrive.json';
import type { DriveRegistration } from './GoogleDrive';

/** The empty source template is replaced in dist by compile-app.mjs. */
export const driveRegistrationSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/),
  clientValue: z.string().trim().max(512),
});

const parsed = driveRegistrationSchema.safeParse(bundled);
export const googleDriveRegistration: Readonly<DriveRegistration> | null =
  parsed.success ? Object.freeze(parsed.data) : null;
