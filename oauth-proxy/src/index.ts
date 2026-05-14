import { parseCookie, stringifySetCookie } from "cookie";
import * as z from "zod";

export const URL_BASE = new URL("https://login.eveonline.com/");
export const PATH_CONFIG = "/.well-known/openid-configuration";
export const URL_CONFIG = new URL(PATH_CONFIG, URL_BASE);
export const PATH_AUTH = "/v2/oauth/authorize";
export const URL_AUTH = new URL(PATH_AUTH, URL_BASE);
export const PATH_CALLBACK = "/callback";

export const PARAM_REDIRECT_URI = "redirect_uri";
export const COOKIE_REDIRECT_URI = "redirect-uri";

export const OpenIdConfig = z.looseObject({
  authorization_endpoint: z.url({ protocol: /^https?$/ }),
  token_endpoint: z.url({ protocol: /^https?$/ }),
});

export const enum HTTP_STATUS {
  OK = 200,
  TEMPORARY_REDIRECT = 307,
  BAD_REQUEST = 400,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
  BAD_GATEWAY = 502,
}

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    const currentUrl = new URL(request.url);
    const pathname = currentUrl.pathname.replace(/\/$/, "");

    switch (`${request.method}:${pathname}`) {
      case `GET:${PATH_CONFIG}`:
        return handleOpenIdConfig(request);
      case `GET:${PATH_AUTH}`:
        return handleAuth(request);
      case `GET:${PATH_CALLBACK}`:
        return handleCallback(request);
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

function handleAuth(request: Request): Response {
  const currentUrl = new URL(request.url);
  const originalRedirectUri = currentUrl.searchParams.get(PARAM_REDIRECT_URI);
  if (!originalRedirectUri || !URL.canParse(originalRedirectUri))
    return err(HTTP_STATUS.BAD_REQUEST);

  const newRedirectUri = new URL(currentUrl);
  newRedirectUri.searchParams.set(
    PARAM_REDIRECT_URI,
    new URL(PATH_CALLBACK, currentUrl).toString(),
  );
  newRedirectUri.protocol = URL_AUTH.protocol;
  newRedirectUri.host = URL_AUTH.host;
  // This has to be set seperately, as `URL_AUTH` lacks a port.
  newRedirectUri.port = URL_AUTH.port;
  newRedirectUri.pathname = URL_AUTH.pathname;
  const headers = new Headers({
    Location: newRedirectUri.toString(),
    "Set-Cookie": stringifySetCookie({
      name: COOKIE_REDIRECT_URI,
      value: originalRedirectUri,
      path: PATH_CALLBACK,
      httpOnly: true,
      sameSite: "lax",
    }),
  });

  return new Response(null, {
    status: HTTP_STATUS.TEMPORARY_REDIRECT,
    headers,
  });
}

function handleCallback(request: Request): Response {
  const cookies = parseCookie(request.headers.get("cookie") ?? "");
  const originalRedirectUri = cookies[COOKIE_REDIRECT_URI];
  if (!originalRedirectUri) return err(HTTP_STATUS.BAD_REQUEST);

  const location = URL.parse(originalRedirectUri);
  if (!location) return err(HTTP_STATUS.BAD_REQUEST);
  location.search = new URL(request.url).search;
  return new Response(null, {
    status: HTTP_STATUS.TEMPORARY_REDIRECT,
    headers: new Headers({
      Location: location.toString(),
      "Set-Cookie": stringifySetCookie({
        name: COOKIE_REDIRECT_URI,
        value: undefined,
        maxAge: -1,
      }),
    }),
  });
}

function isOk(status: number): boolean {
  return Math.floor(status / 100) === 2;
}

function err(status: HTTP_STATUS): Response {
  return new Response(null, { status });
}
