export const GITHUB_CALLBACK_PATH = "/auth/github/callback";

export const githubCallbackUrl = (requestUrl: string): string =>
  new URL(GITHUB_CALLBACK_PATH, requestUrl).href;
