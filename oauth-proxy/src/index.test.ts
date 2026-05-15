import { parseSetCookie, stringifyCookie } from "cookie";
import { describe, expect, it as itBase } from "vitest";

import { exports } from "cloudflare:workers";
import {
  COOKIE_REDIRECT_URI,
  GRANT_TYPE,
  HTTP_STATUS,
  OpenIdConfig,
  PARAM_GRANT_TYPE,
  PARAM_REDIRECT_URI,
  PATH_AUTH,
  PATH_CALLBACK,
  PATH_CONFIG,
  PATH_TOKEN,
} from "./index";

const WORKER_BASE = new URL("https://worker.com");
const UPSTREAM_BASE = new URL("https://upstream.com");
const DOWNSTREAM_BASE = new URL("https://downstream.com");

interface RequestOptions {
  method?: string;
  base?: URL;
  cookies?: Record<string, string>;
  headers?: HeadersInit;
  body?: BodyInit;
}

async function makeRequest(
  pathname: string,
  options?: RequestOptions,
): Promise<Response> {
  if (!options) options = {};
  if (!options.method) options.method = "GET";
  if (!options.base) options.base = WORKER_BASE;
  if (!options.cookies) options.cookies = {};
  if (!options.headers) options.headers = new Headers();

  const cookies = stringifyCookie(options.cookies);
  const headers = new Headers(options.headers);
  headers.set("Cookie", cookies);

  return exports.default.fetch(new URL(pathname, options.base), {
    method: options.method,
    redirect: "manual",
    headers,
    body: options.body,
  });
}

const it = itBase.extend("faultyUpstream", async ({}, { onCleanup }) => {
  await fetch(new URL("/faulty/true", UPSTREAM_BASE), { method: "POST" });
  onCleanup(
    async () =>
      void (await fetch(new URL("/faulty/false", UPSTREAM_BASE), {
        method: "POST",
      })),
  );
});

describe("openid config", () => {
  it.for([PATH_CONFIG, `${PATH_CONFIG}/`])(
    "modify two urls, and retain the others",
    async (pathname) => {
      const resp = await makeRequest(pathname);
      expect(resp.status).toBe(HTTP_STATUS.OK);

      const config = OpenIdConfig.parse(await resp.json());
      expect(config).toMatchInlineSnapshot(`{
  "authorization_endpoint": "https://worker.com/oauth/authorize",
  "something_else": "somthing very important",
  "token_endpoint": "https://worker.com/oauth/token",
}`);
    },
  );

  it.for(["https://127.0.0.1:5173", "https://localhost:5173"])(
    "use http for local dev server",
    async (base) => {
      const url = new URL(PATH_CONFIG, base);
      const resp = await exports.default.fetch(url);
      expect(resp.status).toBe(HTTP_STATUS.OK);

      const config = OpenIdConfig.parse(await resp.json());
      expect(config.authorization_endpoint).toMatch(/^http:/);
      expect(config.token_endpoint).toMatch(/^http:/);
    },
  );

  it("return 502 on faulty upstream", async ({ faultyUpstream: _ }) => {
    const resp = await makeRequest(PATH_CONFIG);
    expect(resp.status).toBe(HTTP_STATUS.BAD_GATEWAY);
  });
});

describe("auth", () => {
  const pathnameShouldPass = encodeURI(
    `${PATH_AUTH}?${PARAM_REDIRECT_URI}=${DOWNSTREAM_BASE.toString()}&foo=bar`,
  );

  it("rewrite redirect_uri, retain other params, set cookies, and redirect", async () => {
    const resp = await makeRequest(pathnameShouldPass);

    expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
    expect(Object.fromEntries(resp.headers.entries())).toMatchInlineSnapshot(`{
  "location": "https://login.eveonline.com/v2/oauth/authorize?redirect_uri=https%3A%2F%2Fworker.com%2Fcallback&foo=bar",
  "set-cookie": "redirect-uri=https%3A%2F%2Fdownstream.com%2F; Path=/callback; HttpOnly; SameSite=Lax",
}`);
  });

  it.for([
    "foo=bar",
    `${PARAM_REDIRECT_URI}=${encodeURIComponent("https//upstream.com")}`,
  ])("return 400 on missing or invalid redirect_uri", async (params) => {
    const resp = await makeRequest(`${PATH_AUTH}?${params}`);
    expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  describe("location header", () => {
    it("have correct protocol, hostname and no port", async () => {
      const resp = await makeRequest(pathnameShouldPass, {
        method: "GET",
        base: new URL("http://worker.com:5173"),
      });
      expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
      expect(resp.headers.get("location")).toMatch(
        /^https:\/\/login.eveonline.com\//,
      );
    });
  });

  describe("rewritten redirect_uri", () => {
    it.for(["http://127.0.0.1:5173", "https://preview.downstream.com"])(
      "be based on current url",
      async (base) => {
        const resp = await makeRequest(pathnameShouldPass, {
          method: "GET",
          base: new URL(base),
        });
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);

        const location = new URL(resp.headers.get("location") ?? "");
        const redirectUri = location.searchParams.get(PARAM_REDIRECT_URI);
        expect(redirectUri).toBe(`${base}${PATH_CALLBACK}`);
      },
    );
  });

  describe("set-cookie header", () => {
    it.for(["http://127.0.0.1:5173", "https://preview.worker.com"])(
      "shoud be based on original redirect_uri",
      async (redirectUri) => {
        const url = encodeURI(
          `${PATH_AUTH}?${PARAM_REDIRECT_URI}=${redirectUri}`,
        );
        const resp = await makeRequest(url);
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);

        const setCookie = parseSetCookie(
          resp.headers.getSetCookie().at(0) ?? "",
        );
        expect(setCookie.value).toBe(redirectUri);
      },
    );
  });
});

describe("callback", () => {
  it("redirect to the original redirect_uri, and delete cookie", async () => {
    const resp = await makeRequest(PATH_CALLBACK, {
      cookies: { [`${COOKIE_REDIRECT_URI}`]: DOWNSTREAM_BASE.toString() },
    });
    expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
    expect(Object.fromEntries(resp.headers.entries())).toMatchInlineSnapshot(
      `{
  "location": "https://downstream.com/",
  "set-cookie": "redirect-uri=; Max-Age=-1",
}`,
    );
  });

  it.for([
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    {} as Record<string, string>,
    { [`${COOKIE_REDIRECT_URI}`]: "https//worker.com" },
  ])("return 400 on missing or invalid cookie", async (cookies) => {
    const resp = await makeRequest(PATH_CALLBACK, { cookies });
    expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  describe("location header", () => {
    it.for(["http://127.0.0.1:5173/", "https://preview.worker.com/"])(
      "be based on cookie",
      async (redirectUri) => {
        const resp = await makeRequest(PATH_CALLBACK, {
          cookies: { [`${COOKIE_REDIRECT_URI}`]: redirectUri },
        });
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
        expect(resp.headers.get("location")).toBe(redirectUri);
      },
    );

    it.for(["", "?foo=bar", "?state=some-state&code=some-code"])(
      "leave all params untouched, be they correct or not",
      async (params) => {
        const resp = await makeRequest(`${PATH_CALLBACK}/${params}`, {
          cookies: { [`${COOKIE_REDIRECT_URI}`]: DOWNSTREAM_BASE.toString() },
        });
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
        expect(resp.headers.get("location")).toBe(
          `${DOWNSTREAM_BASE.toString()}${params}`,
        );
      },
    );

    it.for(["?state=123&code=456", "?foo=bar"])(
      "remove any params set in cookie",
      async (params) => {
        const callbackParams = "?state=some-state&code=some-code";
        const resp = await makeRequest(`${PATH_CALLBACK}/${callbackParams}`, {
          cookies: {
            [`${COOKIE_REDIRECT_URI}`]: `${DOWNSTREAM_BASE.toString()}${params}`,
          },
        });
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
        expect(resp.headers.get("location")).toBe(
          `${DOWNSTREAM_BASE.toString()}${callbackParams}`,
        );
      },
    );
  });

  it("append / to root path, if not present", async () => {
    const resp = await makeRequest(PATH_CALLBACK, {
      cookies: { [`${COOKIE_REDIRECT_URI}`]: "https://worker.com" },
    });
    expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
    expect(resp.headers.get("location")).toBe("https://worker.com/");
  });
});

describe("token", () => {
  describe("authorization_code", () => {
    it("rewrite redirect_uri, retain other params, and forward to upstream", async () => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, GRANT_TYPE.REDEEM);
      body.set(PARAM_REDIRECT_URI, DOWNSTREAM_BASE.toString());
      body.set("foo", "bar");

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.OK);
      expect(await resp.json()).toMatchObject({
        received: {
          [PARAM_GRANT_TYPE]: GRANT_TYPE.REDEEM,
          [PARAM_REDIRECT_URI]: "https://worker.com/callback",
          foo: "bar",
        },
      });
    });

    it("return 400 on missing redirect_uri", async () => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, GRANT_TYPE.REDEEM);
      body.set("foo", "bar");

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it("return 400 on multiple redirect_uri occurrences", async () => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, GRANT_TYPE.REDEEM);
      body.append(PARAM_REDIRECT_URI, DOWNSTREAM_BASE.toString());
      body.append(PARAM_REDIRECT_URI, "https://worker.com/callback");

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });
  });

  describe("refresh_token", () => {
    it("retain all params, with the absence of redirect_uri", async () => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, GRANT_TYPE.REFRESH);
      body.set("foo", "bar");

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.OK);
      expect(await resp.json()).toMatchObject({
        received: {
          [PARAM_GRANT_TYPE]: GRANT_TYPE.REFRESH,
          foo: "bar",
        },
      });
    });

    it("return 400 when redirect_uri is present", async () => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, GRANT_TYPE.REFRESH);
      body.append(PARAM_REDIRECT_URI, DOWNSTREAM_BASE.toString());
      body.set("foo", "bar");

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });
  });

  it("return 400 on other grant_type values", async () => {
    const body = new FormData();
    body.set(PARAM_GRANT_TYPE, "something_else");

    const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
    expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it("return 400 on missing grant_type", async () => {
    const body = new FormData();
    body.set("foo", "bar");

    const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
    expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  // TODO: Maybe we should instead silently ignore query params?
  it.for([GRANT_TYPE.REDEEM, GRANT_TYPE.REFRESH])(
    "return 400 on non-empty query params",
    async (grantType) => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, grantType);
      if (grantType === GRANT_TYPE.REDEEM)
        body.set(PARAM_REDIRECT_URI, DOWNSTREAM_BASE.toString());

      const resp = await makeRequest(`${PATH_TOKEN}?foo=bar`, {
        method: "POST",
        body,
      });
      expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
    },
  );

  // TODO: Should we instead pass-through all non-OK responses?
  it.for([GRANT_TYPE.REDEEM, GRANT_TYPE.REFRESH])(
    "return 502 on faulty upstream",
    async (grantType, { faultyUpstream: _ }) => {
      const body = new FormData();
      body.set(PARAM_GRANT_TYPE, grantType);
      if (grantType === GRANT_TYPE.REDEEM)
        body.set(PARAM_REDIRECT_URI, DOWNSTREAM_BASE.toString());

      const resp = await makeRequest(PATH_TOKEN, { method: "POST", body });
      expect(resp.status).toBe(HTTP_STATUS.BAD_GATEWAY);
    },
  );
});

describe("fallback", () => {
  it.for(["/", "/foo"])("return 404", async (pathname) => {
    const resp = await makeRequest(pathname);
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it.for([
    [PATH_CONFIG, "POST"],
    [PATH_AUTH, "POST"],
    [PATH_CALLBACK, "POST"],
    [PATH_TOKEN, "GET"],
  ])("fallback to 404 on wrong methods", async ([pathname, method]) => {
    const resp = await makeRequest(pathname, { method });
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
