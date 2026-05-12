/// <reference types="vitest/config" />

import { fileURLToPath, URL } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite";

import { HTTP_STATUS, PATH_CONFIG } from "./src/index";

export default defineConfig({
  plugins: !process.env.VITEST
    ? [cloudflare()]
    : [
        cloudflareTest({
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: { outboundService: handleOutboundService },
        }),
      ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

// Tests in a single file run sequentially by default, and we have only
// one test file, so it's safe to read and mutate this global variable.
let faultyUpstream = false;

export function handleOutboundService(request: Request): Response {
  const EXAMPLE_BASE = new URL("https://example.com/oauth/");

  const url = new URL(request.url);

  switch (`${request.method}:${url.pathname}`) {
    case `GET:${PATH_CONFIG}`:
      if (faultyUpstream)
        return new Response(null, {
          status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        });
      return Response.json({
        authorization_endpoint: new URL("authorize", EXAMPLE_BASE).toString(),
        token_endpoint: new URL("token", EXAMPLE_BASE).toString(),
        something_else: "somthing very important",
      });
    case `POST:/faulty/true`:
      faultyUpstream = true;
      return new Response(null);
    case `POST:/faulty/false`:
      faultyUpstream = false;
      return new Response(null);
    default:
      return new Response(null, { status: HTTP_STATUS.NOT_FOUND });
  }
}
