import type { APIRoute } from "astro";
import { clearSessionCookie, destroy } from "../session";
import { logoutResponse } from "./logout-handler";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  logoutResponse({ request, destroy, clearCookie: clearSessionCookie() });
