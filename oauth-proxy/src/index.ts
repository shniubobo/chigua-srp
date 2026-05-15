import { parseCookie, stringifySetCookie } from "cookie";
import * as z from "zod";

export const PATH_CONFIG = "/.well-known/openid-configuration";
export const PATH_AUTH = "/v2/oauth/authorize";
export const PATH_TOKEN = "/v2/oauth/token";
export const PATH_CALLBACK = "/callback";

export const URL_BASE = new URL("https://login.eveonline.com/");
export const URL_CONFIG = new URL(PATH_CONFIG, URL_BASE);
export const URL_AUTH = new URL(PATH_AUTH, URL_BASE);
export const URL_TOKEN = new URL(PATH_TOKEN, URL_BASE);

export const PARAM_REDIRECT_URI = "redirect_uri";
export const COOKIE_REDIRECT_URI = "redirect-uri";

export const PARAM_GRANT_TYPE = "grant_type";
export const enum GRANT_TYPE {
  REDEEM = "authorization_code",
  REFRESH = "refresh_token",
}

export const HEADER_CORS_ORIGIN = "Access-Control-Allow-Origin";

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
    let resp = await handleFetch(request);

    try {
      resp.headers.set(HEADER_CORS_ORIGIN, "*");
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;

      // `handleToken` directly returns the upstream response, which itself, and
      // whose headers, are immutable, so we have to create a new `Response`
      // from it.
      //
      // ESI OAuth returns a CORS header, but it seems to be stripped away by
      // cloudflare, so we have to add one anyway.
      resp = new Response(resp.body, resp);
      resp.headers.set(HEADER_CORS_ORIGIN, "*");
    }

    return resp;
  },
} satisfies ExportedHandler<Env>;

async function handleFetch(request: Request): Promise<Response> {
  const currentUrl = new URL(request.url);
  const pathname = currentUrl.pathname.replace(/\/$/, "");

  switch (`${request.method}:${pathname}`) {
    case `GET:${PATH_CONFIG}`:
      return handleOpenIdConfig(request);
    case `GET:${PATH_AUTH}`:
      return handleAuth(request);
    case `GET:${PATH_CALLBACK}`:
      return handleCallback(request);
    case `POST:${PATH_TOKEN}`:
      return handleToken(request);
    default:
      return err(HTTP_STATUS.NOT_FOUND);
  }
}

async function handleOpenIdConfig(request: Request): Promise<Response> {
  const config = await fetch(URL_CONFIG);
  if (!config.ok) return err(HTTP_STATUS.BAD_GATEWAY);

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

  const location = new URL(currentUrl);
  const newRedirectUri = new URL(PATH_CALLBACK, currentUrl);
  location.searchParams.set(PARAM_REDIRECT_URI, newRedirectUri.toString());
  location.protocol = URL_AUTH.protocol;
  location.host = URL_AUTH.host;
  // This has to be set seperately, as `URL_AUTH` lacks a port.
  location.port = URL_AUTH.port;
  location.pathname = URL_AUTH.pathname;
  const headers = new Headers({
    Location: location.toString(),
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

async function handleToken(request: Request): Promise<Response> {
  const currentUrl = new URL(request.url);
  if (currentUrl.search) return err(HTTP_STATUS.BAD_REQUEST);

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    if (e instanceof TypeError) return err(HTTP_STATUS.BAD_REQUEST);
    throw e;
  }

  const grantType = formData.get(PARAM_GRANT_TYPE);
  const originalRedirectUri = formData.getAll(PARAM_REDIRECT_URI);

  if (grantType === GRANT_TYPE.REDEEM) {
    if (originalRedirectUri.length !== 1) return err(HTTP_STATUS.BAD_REQUEST);

    // We don't check whether `originalRedirectUri` is a valid URI here, and
    // that is intentional. We've checked that in `handleAuth`, and the upstream
    // will make sure it remains the same throughout the OAuth flow.

    const newRedirectUri = new URL(PATH_CALLBACK, request.url);
    formData.set(PARAM_REDIRECT_URI, newRedirectUri.toString());
  } else if (grantType === GRANT_TYPE.REFRESH) {
    if (originalRedirectUri.length !== 0) return err(HTTP_STATUS.BAD_REQUEST);
  } else {
    return err(HTTP_STATUS.BAD_REQUEST);
  }

  const upstream = await fetch(URL_TOKEN, { method: "POST", body: formData });
  if (!upstream.ok) return err(HTTP_STATUS.BAD_GATEWAY);
  return upstream;
}

function err(status: HTTP_STATUS): Response {
  return new Response(null, { status });
}
