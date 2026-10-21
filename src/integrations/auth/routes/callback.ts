import type { APIRoute } from "astro";
import { callbackResponse } from "./callback-handler";

export const prerender = false;

export const GET: APIRoute = ({ request }) => callbackResponse({ request });
