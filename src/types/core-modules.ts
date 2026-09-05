import type { FcaState } from "./core";

export interface RequestCore {
  get: (...args: Loose[]) => Promise<Loose>;
  post: (...args: Loose[]) => Promise<Loose>;
  postFormData: (...args: Loose[]) => Promise<Loose>;
  jar: Loose;
  makeDefaults: (...args: Loose[]) => Loose;
  client?: Loose;
  setProxy?: (proxyUrl?: string) => void;
}

export interface AuthCore {
  REGION_MAP: Map<string, { code: string; name: string; location: string }>;
  parseRegion: (html: string) => string;
  normalizeCookieHeaderString: (cookieHeader: string) => string[];
  setJarFromPairs: (jar: Loose, pairs: string[], domain: string) => void;
}

export interface StateCore {
  createFcaState: (input: Record<string, Loose>) => FcaState;
  createApiFacade: (params: Record<string, Loose>) => Record<string, Loose>;
  attachThreadUpdater: (ctx: FcaState, models: Loose, logger: (text: string, type?: string) => void) => boolean;
}

export interface MqttCore {
  attachMqttCompatibility: (
    api: Record<string, Loose>,
    options?: { logger?: (text: string, type?: string) => void; refreshIntervalMs?: number }
  ) => NodeJS.Timeout | null;
}

