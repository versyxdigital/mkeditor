import { GoogleDrive, type DriveRegistration } from './GoogleDrive';
import { Dropbox } from './Dropbox';
import { googleDriveRegistration } from './GoogleDriveRegistration';
import { dropboxRegistration } from './DropboxRegistration';
import { CloudServiceBase } from './CloudServiceBase';
import type { CloudProvider, CloudRegistration } from './CloudProvider';
import type { CloudPersistence } from './CloudStore';
import type { CloudRecoveryStore } from './CloudRecoveryStore';
import type { CloudState } from '../../interfaces/Cloud';

/** Desktop composition retains OS credential storage and loopback authorization. */
export class CloudService extends CloudServiceBase {
  constructor(
    store: CloudPersistence,
    openBrowser: (url: string) => Promise<void>,
    push: (state: CloudState) => void,
    drive = new GoogleDrive(),
    registration: Readonly<DriveRegistration> | null = googleDriveRegistration,
    recovery?: CloudRecoveryStore,
    additional: {
      dropbox?: CloudProvider;
      dropboxRegistration?: CloudRegistration | null;
    } = {},
  ) {
    super(store, openBrowser, push, drive, registration, recovery, {
      dropbox: additional.dropbox ?? new Dropbox(),
      dropboxRegistration:
        additional.dropboxRegistration === undefined
          ? dropboxRegistration
          : additional.dropboxRegistration,
    });
  }
}
