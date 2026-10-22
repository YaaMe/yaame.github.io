// Astro reads this declaration from the injected source without following exports.
export const prerender = false;
export { GET, POST } from "../../../routes/activitypub/federated.ts";
