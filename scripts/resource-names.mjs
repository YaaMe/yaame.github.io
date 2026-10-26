import { site } from "../src/config/site.config.ts";

const author = site.author;
// Cloudflare names allow lowercase letters, digits and inner hyphens; a display
// form of the name here would generate names no live resource has.
if (typeof author !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(author)) {
  throw new Error(
    "src/config/site.config.ts: site.author must be a non-empty string of lowercase letters, digits and inner hyphens",
  );
}

export const resourceNames = {
  siteWorker: `${author}-blogu`,
  consumerWorker: `${author}-ap-consumer`,
  deliveryQueue: `${author}-ap-delivery`,
  database: `${author}-ap-interactions`,
};

if (import.meta.main) {
  const names = process.argv.slice(2).map((key) => {
    if (!Object.hasOwn(resourceNames, key)) throw new Error(`Unknown resource name: ${key}`);
    return resourceNames[key];
  });
  console.log(names.join("\n"));
}
