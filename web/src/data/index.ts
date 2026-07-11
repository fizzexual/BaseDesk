import type { Repository } from './repository';
import { ApiRepository } from './api';
import { LocalRepository } from './local';

// import.meta.env is accessed with optional chaining so this module also loads
// under plain Node (vitest) where Vite's env object is not injected.
export const repo: Repository =
  import.meta.env?.VITE_DEMO === '1' ? new LocalRepository() : new ApiRepository();
