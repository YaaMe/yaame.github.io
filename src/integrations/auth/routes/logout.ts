import type { APIRoute } from "astro";
import { destroy } from "../../../services/session";
import { clearSessionCookie } from "../session-core";
import { logoutResponse } from "./logout-handler";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  logoutResponse({ request, destroy, clearCookie: clearSessionCookie() });
