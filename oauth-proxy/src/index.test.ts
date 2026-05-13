import { describe, expect, it as itBase } from "vitest";

import { exports } from "cloudflare:workers";
import {
  HTTP_STATUS,
  OpenIdConfig,
  PATH_AUTH,
  PATH_CALLBACK,
  PATH_CONFIG,
} from "./index";

const WORKER_BASE = new URL("https://worker.com");
const UPSTREAM_BASE = new URL("https://upstream.com");
const DOWNSTREAM_BASE = new URL("https://downstream.com");

async function makeRequest(
  pathname: string,
  method: string = "GET",
  base: URL = WORKER_BASE,
): Promise<Response> {
  return exports.default.fetch(new URL(pathname, base), {
    method,
    redirect: "manual",
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
    "should modify two urls, and retain the others",
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

  it.for(["https://127.0.0.1:5137", "https://localhost:5137"])(
    "should use http for local dev server",
    async (base) => {
      const url = new URL(PATH_CONFIG, base);
      const resp = await exports.default.fetch(url);
      expect(resp.status).toBe(HTTP_STATUS.OK);

      const config = OpenIdConfig.parse(await resp.json());
      expect(config.authorization_endpoint).toMatch(/^http:/);
      expect(config.token_endpoint).toMatch(/^http:/);
    },
  );

  it("should return 502 on faulty upstream", async ({ faultyUpstream: _ }) => {
    const resp = await makeRequest(PATH_CONFIG);
    expect(resp.status).toBe(HTTP_STATUS.BAD_GATEWAY);
  });
});

describe("auth", () => {
  const pathnameShouldPass = encodeURI(
    `${PATH_AUTH}?redirect_uri=${DOWNSTREAM_BASE.toString()}&foo=bar`,
  );

  it("should rewrite redirect_uri, retain other params, set cookies, and redirect", async () => {
    const resp = await makeRequest(pathnameShouldPass);

    expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
    expect(Object.fromEntries(resp.headers.entries())).toMatchInlineSnapshot(`{
  "location": "https://login.eveonline.com/v2/oauth/authorize?redirect_uri=https%3A%2F%2Fworker.com%2Fcallback&foo=bar",
  "set-cookie": "redirect-uri=https%3A%2F%2Fdownstream.com%2F; Path=/callback; HttpOnly; SameSite=Lax",
}`);
  });

  it.for([
    "foo=bar",
    `redirect_uri=${encodeURIComponent("https//upstream.com")}`,
  ])("should return 400 on missing or invalid redirect_uri", async (params) => {
    const resp = await makeRequest(`${PATH_AUTH}?${params}`);
    expect(resp.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  describe("location header", () => {
    it("should have correct protocol, hostname and no port", async () => {
      const resp = await makeRequest(
        pathnameShouldPass,
        "GET",
        new URL("http://worker.com:5137"),
      );
      expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);
      expect(resp.headers.get("location")).toMatch(
        /^https:\/\/login.eveonline.com\//,
      );
    });
  });

  describe("rewritten redirect_uri", () => {
    it.for(["http://127.0.0.1:5137", "https://preview.worker.com"])(
      "should be based on current url",
      async (base) => {
        const resp = await makeRequest(
          pathnameShouldPass,
          "GET",
          new URL(base),
        );
        expect(resp.status).toBe(HTTP_STATUS.TEMPORARY_REDIRECT);

        const location = new URL(resp.headers.get("location") ?? "");
        const redirectUri = location.searchParams.get("redirect_uri");
        expect(redirectUri).toBe(`${base}${PATH_CALLBACK}`);
      },
    );
  });
});

describe("fallback", () => {
  it.for(["/", "/foo"])("should return 404", async (pathname) => {
    const resp = await makeRequest(pathname);
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it.for([
    [PATH_CONFIG, "POST"],
    [PATH_AUTH, "POST"],
  ])("should fallback to 404 on wrong methods", async ([pathname, method]) => {
    const resp = await makeRequest(pathname, method);
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
