import * as z from "zod";

const URL_BASE = new URL("https://login.eveonline.com/");
const PATH_CONFIG = "/.well-known/openid-configuration";
const URL_CONFIG = new URL(PATH_CONFIG, URL_BASE);

const OpenIdConfig = z.looseObject({
  authorization_endpoint: z.httpUrl(),
  token_endpoint: z.httpUrl(),
});

const enum HTTP_STATUS {
  NOT_FOUND = 404,
  BAD_GATEWAY = 502,
}

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    const currentUrl = new URL(request.url);
    const pathname = currentUrl.pathname.replace(/\/$/, "");

    switch (pathname) {
      case PATH_CONFIG:
        return handleOpenIdConfig(request);
      default:
        return err(HTTP_STATUS.NOT_FOUND);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleOpenIdConfig(request: Request): Promise<Response> {
  const config = await fetch(URL_CONFIG);
  if (!isOk(config.status)) return err(HTTP_STATUS.BAD_GATEWAY);

  let configJson;
  let configParsed;
  try {
    configJson = await config.json();
    configParsed = OpenIdConfig.parse(configJson);
  } catch (e) {
    if (e instanceof z.ZodError) {
      console.error({
        stack: e.stack,
        config: configJson,
        zod_issues: e.issues,
      });
      return err(HTTP_STATUS.BAD_GATEWAY);
    }
    throw e;
  }

  const authEndpoint = new URL(configParsed.authorization_endpoint);
  const tokenEndpoint = new URL(configParsed.token_endpoint);

  const currentUrlHost = new URL(request.url).host;
  authEndpoint.host = currentUrlHost;
  tokenEndpoint.host = currentUrlHost;

  if (
    currentUrlHost.includes("localhost") ||
    currentUrlHost.includes("127.0.0.1")
  ) {
    // Local development server, disable HTTPS.
    authEndpoint.protocol = "http";
    tokenEndpoint.protocol = "http";
  }

  configParsed.authorization_endpoint = authEndpoint.toString();
  configParsed.token_endpoint = tokenEndpoint.toString();

  return Response.json(configParsed);
}

function isOk(status: number): boolean {
  return Math.floor(status / 100) === 2;
}

function err(status: HTTP_STATUS): Response {
  return new Response(null, { status });
}
