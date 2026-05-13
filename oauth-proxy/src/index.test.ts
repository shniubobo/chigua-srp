import { describe, expect, it as itBase } from "vitest";

import { exports } from "cloudflare:workers";
import { HTTP_STATUS, OpenIdConfig, PATH_CONFIG } from "./index";

const WORKER_BASE = new URL("https://worker.com");
const UPSTREAM_BASE = new URL("https://upstream.com");

async function makeRequest(
  pathname: string,
  method: string = "GET",
): Promise<Response> {
  return exports.default.fetch(new URL(pathname, WORKER_BASE), { method });
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

  it("should fallback to 404 on non-GET requests", async () => {
    const resp = await makeRequest(PATH_CONFIG, "POST");
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it("should return 502 on faulty upstream", async ({ faultyUpstream: _ }) => {
    const resp = await makeRequest(PATH_CONFIG);
    expect(resp.status).toBe(HTTP_STATUS.BAD_GATEWAY);
  });
});

describe("fallback", () => {
  it.for(["/", "/foo"])("should return 404", async (pathname) => {
    const resp = await makeRequest(pathname);
    expect(resp.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
