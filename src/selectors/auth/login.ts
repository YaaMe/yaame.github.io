import { site } from "../../config/site.config.ts";
import type { ActiveSession, Role } from "../../models/records/sessions.ts";

const WHY: Record<string, string> = {
  state: "请求没有带上我们发出的凭据，登录已中止。重新点一次即可。",
  verifier: "登录凭据不完整，登录已中止。重新点一次即可。",
  code: "GitHub 没有回传授权码。",
  exchange: "跟 GitHub 换令牌失败，可能是授权码过期了。",
  user: "换到了令牌，但读不到你的账号信息。",
  config: "这一侧还没配置好，不是你的问题。",
};

const ROLE: Record<Role, string> = {
  owner: "站长",
  allowed: "名单内",
  guest: "访客",
};

export function loginPage(session: ActiveSession | null, error: string | null) {
  return {
    title: `login · ${site.title}`,
    error: error ? WHY[error] ?? "登录没有完成。" : null,
    session: session ? { login: session.login, role: ROLE[session.role] } : null,
  };
}

export type LoginPageData = ReturnType<typeof loginPage>;
