import type { APIRoute } from "astro";
import { platform } from "../../../platform";
import { create } from "../session";
import { callbackResponse } from "./callback-handler";

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  callbackResponse({
    request,
    store: { secret: (name) => platform.secret(name), create },
  });
