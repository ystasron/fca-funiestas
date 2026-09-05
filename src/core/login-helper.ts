import type { FcaOptions } from "./state";
import legacyImpl from "./login-helper.impl";

interface LoginApi {
  getCurrentUserID?: () => string;
  getCookies?: () => string;
  [key: string]: Loose;
}

type LoginHelperCallback = (error: Error | null, api?: LoginApi) => void;

type LegacyLoginHelper = ((
  appState: Loose,
  cookieInput: string | string[] | Record<string, string> | undefined,
  email: string | undefined,
  password: string | undefined,
  globalOptions: FcaOptions,
  callback: LoginHelperCallback
) => void) & {
  loginHelper: (
    appState: Loose,
    cookieInput: string | string[] | Record<string, string> | undefined,
    email: string | undefined,
    password: string | undefined,
    globalOptions: FcaOptions,
    callback: LoginHelperCallback
  ) => void;
  normalizeCookieHeaderString: (cookieHeader: string) => string[];
  setJarFromPairs: (
    jar: {
      setCookieSync?: (cookie: string, url: string) => void;
      setCookie?: (cookie: string, url: string, cb?: (err?: Error | null) => void) => void;
    },
    pairs: string[],
    domain: string
  ) => void;
};

const legacy = legacyImpl as unknown as LegacyLoginHelper;

export = legacy;

