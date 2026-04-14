import {
  EsiClient,
  type GetCharacterMailMailIdResponse,
  type GetCharacterMailResponse,
  type GetCharacterResponse,
  type GetKillmailKillmailHashResponse,
} from "@localisprimary/esi";
import { useCookies } from "@vueuse/integrations/useCookies";
import { decodeJwt } from "jose";
import * as openid from "openid-client";
import { VxeUI } from "vxe-pc-ui";
import { toDateString } from "xe-utils";

import { ErrorMessage, throwOnStatus } from "./error";

const OAUTH_URL_BASE = new URL("https://login.eveonline.com/");
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID as string;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI as string;
const SCOPES = ["publicData", "esi-mail.read_mail.v1", "esi-ui.open_window.v1"];
const COOKIE_STATE = "esi-sso-state";
const COOKIE_CODE_VERIFIER = "esi-sso-code-verifier";
const COOKIE_ACCESS_TOKEN = "esi-access-token";
const COOKIE_REFRESH_TOKEN = "esi-refresh-token";
const COOKIE_CHARACTER_NAME = "esi-character-name";
const COOKIE_MAX_AGE = 1 * 60 * 60; // One hour
const MAIL_LIST_NAME = "CHIGUA SRP";
const SRP_OFFICER_CHARACTER_IDS = [
  2113450798, // peter li peter
];
const SRP_OFFICER_MAIL_KEYWORD = "已补";

const cookies = useCookies(undefined, { autoUpdateDependencies: true });

export interface EsiContext {
  client: EsiClient;
  character: Character;
}

export interface Killmail {
  pointer: KillmailPointer;
  killmail: GetKillmailKillmailHashResponse;
}

interface KillmailPointer {
  id: number;
  hash: string;
  report: KillmailReport;
}

interface KillmailReport {
  issuerId?: number;
  date?: Date;
}

export interface Character {
  id: number;
  detail: GetCharacterResponse;
}

export async function prepareToRedirect(): Promise<URL> {
  const oauthConfig = await fetchOAuthConfig();
  const codeVerifier = openid.randomPKCECodeVerifier();
  const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
  const state = openid.randomState();

  cookies.set(COOKIE_STATE, state, { maxAge: COOKIE_MAX_AGE });
  cookies.set(COOKIE_CODE_VERIFIER, codeVerifier, { maxAge: COOKIE_MAX_AGE });

  const urlToRedirectTo = openid.buildAuthorizationUrl(oauthConfig, {
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return urlToRedirectTo;
}

export async function maybeFinalizeSsoLogin(): Promise<void> {
  const state = cookies.get<string | undefined>(COOKIE_STATE);
  const codeVerifier = cookies.get<string | undefined>(COOKIE_CODE_VERIFIER);

  if (state === undefined && codeVerifier === undefined) {
    // OAuth login not initiated.
    return;
  }

  cookies.remove(COOKIE_STATE);
  cookies.remove(COOKIE_CODE_VERIFIER);

  const tokens = await openid.authorizationCodeGrant(
    await fetchOAuthConfig(),
    new URL(location.href),
    {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
    },
  );

  setTokenCookies(tokens);
}

export function getOAuthCharacterName(): string {
  return cookies.get<string | undefined>(COOKIE_CHARACTER_NAME) ?? "";
}

let oauthConfig: openid.Configuration;

async function fetchOAuthConfig(): Promise<openid.Configuration> {
  if (oauthConfig === undefined) {
    oauthConfig = await openid.discovery(OAUTH_URL_BASE, CLIENT_ID);
  }
  return oauthConfig;
}

export async function getAccessTokenOrRefresh(): Promise<string | null> {
  const accessToken = cookies.get<string | undefined>(COOKIE_ACCESS_TOKEN);
  if (accessToken === undefined) {
    return await refreshAccessToken();
  }
  return accessToken;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = cookies.get<string>(COOKIE_REFRESH_TOKEN);
  if (refreshToken === undefined) {
    console.error("Trying to refresh access token while not logged in.");
    return null;
  }
  const oauthConfig = await fetchOAuthConfig();

  const tokens = await openid.refreshTokenGrant(oauthConfig, refreshToken);
  setTokenCookies(tokens);
  return tokens.access_token;
}

function setTokenCookies(
  tokens: openid.TokenEndpointResponse & openid.TokenEndpointResponseHelpers,
): void {
  const accessTokenExpiresIn = tokens.expiresIn();

  cookies.set(COOKIE_ACCESS_TOKEN, tokens.access_token, {
    maxAge: accessTokenExpiresIn,
  });
  if (tokens.refresh_token !== undefined)
    cookies.set(COOKIE_REFRESH_TOKEN, tokens.refresh_token);

  const accessTokenPayload = decodeJwt(tokens.access_token);
  const characterName = accessTokenPayload.name;
  if (characterName !== undefined)
    cookies.set(COOKIE_CHARACTER_NAME, characterName);
}

export function isLoggedIn(): boolean {
  return cookies.get(COOKIE_REFRESH_TOKEN) !== undefined;
}

export function logOut(): void {
  cookies.remove(COOKIE_ACCESS_TOKEN);
  cookies.remove(COOKIE_REFRESH_TOKEN);
  cookies.remove(COOKIE_CHARACTER_NAME);
}

export async function fetchKillmails(
  from: Date,
  to: Date,
  sinceLastSrp: boolean = false,
): Promise<Killmail[]> {
  const accessToken = await getAccessTokenOrRefresh();
  if (accessToken === null) throw new Error(ErrorMessage.NotLoggedIn);

  const esi = await buildEsiContext(accessToken);
  const mailListId = await fetchMailListId(esi);
  const mailHeaders = fetchMailHeaders(esi, mailListId, from, to, sinceLastSrp);
  const mails = await Promise.all(
    (await Array.fromAsync(mailHeaders)).map((header) =>
      fetchMailBody(esi, header),
    ),
  );

  const killmailPointers = mails.flatMap((mail) => parseMail(mail));
  const killmailPromises: Promise<Killmail>[] = [];
  for (const pointer of killmailPointers) {
    killmailPromises.push(fetchKillmail(esi, pointer));
  }

  return await Promise.all(killmailPromises);
}

export async function buildEsiContext(
  accessToken: string,
): Promise<EsiContext> {
  const payload = decodeJwt(accessToken);

  if (payload.sub === undefined)
    throw new Error(ErrorMessage.MalformedAccessToken);

  const subjectSegments = payload.sub.split(":");
  if (subjectSegments.length !== 3)
    throw new Error(ErrorMessage.MalformedAccessToken);
  const characterId = parseInt(subjectSegments[2] as string);

  const client = new EsiClient({ userAgent: "", token: accessToken });

  return {
    client,
    character: await fetchCharacter(client, characterId),
  };
}

async function fetchMailListId(esi: EsiContext): Promise<number> {
  const { data: mailLists, status } = await esi.client.getCharacterMailLists({
    character_id: esi.character.id,
  });
  throwOnStatus(status);

  const mailList = mailLists.find(({ name }) => name === MAIL_LIST_NAME);
  if (mailList === undefined) {
    throw new Error(ErrorMessage.NotSubscribed);
  }
  return mailList.mailing_list_id;
}

async function* fetchMailHeaders(
  esi: EsiContext,
  mailListId: number,
  from: Date,
  to: Date,
  sinceLastSrp: boolean = false,
): AsyncGenerator<GetCharacterMailResponse[number], void, void> {
  let cursor: number | undefined = undefined;

  while (true) {
    const { data: mails, status } = await esi.client.getCharacterMail({
      character_id: esi.character.id,
      last_mail_id: cursor,
    });
    throwOnStatus(status);

    // The mails returned should have already been sorted from latest to
    // earliest, but we're doing that again just in case.
    const mailsSorted = mails.toSorted(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );

    for (const mail of mailsSorted) {
      cursor = mail.mail_id;

      const mailDate = new Date(mail.timestamp);
      if (mailDate < from) return;
      if (mailDate > to) continue;

      // Every mail must have at least one recipient, and it's assumed here
      // that, if someone is sending a mail to a mailing list, they are
      // sending to that mailing list only.
      const firstRecipient = mail.recipients[0];
      if (
        firstRecipient?.recipient_type !== "mailing_list" ||
        firstRecipient.recipient_id !== mailListId
      )
        continue;

      if (
        sinceLastSrp &&
        SRP_OFFICER_CHARACTER_IDS.includes(mail.from) &&
        mail.subject.includes(SRP_OFFICER_MAIL_KEYWORD)
      ) {
        void VxeUI.modal.message({
          id: "since-last-srp",
          content: `邮件标题匹配到关键字“${SRP_OFFICER_MAIL_KEYWORD}”，\
自动忽略 ${toDateString(mail.timestamp, "yyyy-MM-dd HH:mm [E]T")} 前的邮件`,
          status: "info",
          duration: 10000,
        });
        return;
      }

      yield mail;
    }
  }
}

async function fetchMailBody(
  esi: EsiContext,
  mailHeader: GetCharacterMailResponse[number],
): Promise<GetCharacterMailMailIdResponse> {
  const { data: mailContent, status } = await esi.client.getCharacterMailMailId(
    {
      character_id: esi.character.id,
      mail_id: mailHeader.mail_id,
    },
  );
  throwOnStatus(status);
  return mailContent;
}

function parseMail(mail: GetCharacterMailMailIdResponse): KillmailPointer[] {
  // Example:
  // <a href="killReport:134742722:400cbc5598ab0fe7f8930aabf680b8e748bef818">
  const killmailRegex = /<a href="killReport:(?<id>\d+):(?<hash>[\da-f]+)">/g;
  const killmailPointers = mail.body?.matchAll(killmailRegex).map((match) => ({
    id: parseInt(match.groups!.id!),
    hash: match.groups!.hash!,
    report: {
      issuerId: mail.from,
      date: mail.timestamp ? new Date(mail.timestamp) : undefined,
    },
  }));

  if (killmailPointers === undefined) return [];
  return Array.from(killmailPointers);
}

async function fetchKillmail(
  esi: EsiContext,
  pointer: KillmailPointer,
): Promise<Killmail> {
  const { data: killmail, status } = await esi.client.getKillmailKillmailHash({
    killmail_id: pointer.id,
    killmail_hash: pointer.hash,
  });
  throwOnStatus(status);
  return { pointer, killmail };
}

export async function fetchCharacter(
  esi: EsiContext | EsiClient,
  characterId: number,
): Promise<Character> {
  const client = unwrapEsiClient(esi);
  const { data: character, status } = await client.getCharacter({
    character_id: characterId,
  });
  throwOnStatus(status);
  return {
    id: characterId,
    detail: character,
  };
}

function unwrapEsiClient(esi: EsiContext | EsiClient): EsiClient {
  if (Object.hasOwn(esi, "client")) {
    return (esi as EsiContext).client;
  }
  return esi as EsiClient;
}

export async function sendMail(subject: string, body: string): Promise<void> {
  const accessToken = await getAccessTokenOrRefresh();
  if (accessToken === null) throw new Error(ErrorMessage.NotLoggedIn);
  const esi = await buildEsiContext(accessToken);

  await esi.client.postUiOpenwindowNewmail({
    recipients: [0],
    to_mailing_list_id: await fetchMailListId(esi),
    subject,
    body,
  });
}
