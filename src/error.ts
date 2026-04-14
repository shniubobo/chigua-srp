export const enum ErrorMessage {
  AwaitingReview = "Row is awaiting review.",
  HttpStatus = "Non-2xx HTTP status code encountered.",
  MailComposerFinished = "Trying to mutate a finished `MailComposer`.",
  MalformedAccessToken = "Malformed access token.",
  MalformedPriceHistory = "Malformed price history.",
  NotLoggedIn = "Not logged in to ESI.",
  NotSubscribed = "Not subscribed to target mailing list.",
}

export function throwOnStatus(status: number) {
  if (Math.floor(status / 100) !== 2) throw new Error(ErrorMessage.HttpStatus);
}
