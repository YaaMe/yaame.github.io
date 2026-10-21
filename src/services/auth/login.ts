import { exchangeToken, githubUser } from "../../gateways/github.ts";
import { create } from "../session.ts";

export async function loginWithGithub(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ id: string } | { error: "config" | "exchange" | "user" }> {
  const exchange = await exchangeToken(code, verifier, redirectUri);
  if ("error" in exchange) return exchange;
  const user = await githubUser(exchange.token);
  if (!user) return { error: "user" };
  const id = await create({ id: user.id, login: user.login });
  return { id };
}
