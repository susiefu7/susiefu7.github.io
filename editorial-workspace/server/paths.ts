import os from 'node:os';
import path from 'node:path';

/** Where the manuscript project lives unless --project or TLP_PROJECT says otherwise. */
export function defaultProjectPath(): string {
  return process.env.TLP_PROJECT ?? path.join(os.homedir(), 'TheLongPicture');
}
