export const DEFAULT_REGIONS = [
  { code: "PRN", name: "Pacific Northwest Region", location: "Khu vá»±c TÃ¢y Báº¯c ThÃ¡i BÃ¬nh DÆ°Æ¡ng" },
  { code: "VLL", name: "Valley Region", location: "Valley" },
  { code: "ASH", name: "Ashburn Region", location: "Ashburn" },
  { code: "DFW", name: "Dallas/Fort Worth Region", location: "Dallas/Fort Worth" },
  { code: "LLA", name: "Los Angeles Region", location: "Los Angeles" },
  { code: "FRA", name: "Frankfurt", location: "Frankfurt" },
  { code: "SIN", name: "Singapore", location: "Singapore" },
  { code: "NRT", name: "Tokyo", location: "Japan" },
  { code: "HKG", name: "Hong Kong", location: "Hong Kong" },
  { code: "SYD", name: "Sydney", location: "Sydney" },
  { code: "PNB", name: "Pacific Northwest - Beta", location: "Pacific Northwest " }
];

export function createAuthCore(opts: {
  logger?: (message: string, type?: string) => void;
  config?: Record<string, Loose>;
  axiosBase?: Loose;
  regions?: typeof DEFAULT_REGIONS;
} = {}) {
  const REGION_MAP = new Map((opts.regions || DEFAULT_REGIONS).map((r) => [r.code, r]));

  function parseRegion(html: string) {
    try {
      const m1 = html.match(/"endpoint":"([^"]+)"/);
      const m2 = m1 ? null : html.match(/endpoint\\":\\"([^\\"]+)\\"/);
      const raw = (m1 && m1[1]) || (m2 && m2[1]);
      if (!raw) return "PRN";
      const endpoint = raw.replace(/\\\//g, "/");
      const url = new URL(endpoint);
      const rp = url.searchParams ? url.searchParams.get("region") : null;
      return rp ? rp.toUpperCase() : "PRN";
    } catch {
      return "PRN";
    }
  }

  function normalizeCookieHeaderString(s: string) {
    let str = String(s || "").trim();
    if (!str) return [];
    if (/^cookie\s*:/i.test(str)) str = str.replace(/^cookie\s*:/i, "").trim();
    str = str.replace(/\r?\n/g, " ").replace(/\s*;\s*/g, ";");
    const parts = str.split(";").map((v) => v.trim()).filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq <= 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      if (!k) continue;
      out.push(`${k}=${v}`);
    }
    return out;
  }

  function setJarFromPairs(j: Loose, pairs: string[], domain: string) {
    const expires = new Date(Date.now() + 31536e6).toUTCString();
    const urls = [
      "https://www.facebook.com",
      "https://facebook.com",
      "https://m.facebook.com",
      "http://www.facebook.com",
      "http://facebook.com",
      "http://m.facebook.com"
    ];

    for (const kv of pairs) {
      const cookieStr = `${kv}; expires=${expires}; domain=${domain}; path=/;`;
      for (const url of urls) {
        try {
          if (typeof j.setCookieSync === "function") {
            j.setCookieSync(cookieStr, url);
          } else if (typeof j.setCookie === "function") {
            j.setCookie(cookieStr, url);
          }
        } catch { }
      }
    }
  }

  return {
    REGION_MAP,
    parseRegion,
    normalizeCookieHeaderString,
    setJarFromPairs
  };
}


