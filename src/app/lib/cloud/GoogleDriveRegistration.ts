import bundled from '../../config/googleDrive.json';
import type { DriveRegistration } from './GoogleDrive';

/** The empty source template is replaced in dist by compile-app.mjs. */
export { driveRegistrationSchema } from './CloudRegistration';
import { driveRegistrationSchema } from './CloudRegistration';

const parsed = driveRegistrationSchema.safeParse(bundled);
export const googleDriveRegistration: Readonly<DriveRegistration> | null =
  parsed.success ? Object.freeze(parsed.data) : null;
