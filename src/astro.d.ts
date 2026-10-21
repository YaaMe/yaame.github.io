declare module "virtual:astro" {
  export const getCollection: typeof import("./astro.binding").getCollection;
  export const render: typeof import("./astro.binding").render;
}
