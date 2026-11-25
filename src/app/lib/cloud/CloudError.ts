import type { CloudWriteError } from '../../interfaces/Cloud';

/** Never include provider bodies, URLs, tokens or account details in errors. */
export class CloudError extends Error {
  constructor(public readonly code: CloudWriteError) {
    super(`Cloud operation failed: ${code}`);
  }
}
