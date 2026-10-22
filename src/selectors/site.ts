import { site, nav, social, features, other } from "../config/site.config";

export function siteShell(pathname: string, description?: string) {
  return {
    title: site.title,
    lang: site.lang,
    author: site.author,
    description: description ?? site.description,
    canonical: new URL(pathname.endsWith("/") ? pathname : pathname + "/", site.url).href,
    fingerprint: site.fingerprint.match(/.{4}/g)?.join(" ") ?? site.fingerprint,
    nav: nav.slice(1),
    social,
    darkMode: features.darkMode,
    other: { href: other + pathname, label: new URL(other).host },
  };
}

export function notFoundPage() {
  return { title: `404 · ${site.title}`, nav };
}
