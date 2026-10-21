import type * as Astro from "../src/astro.binding";

export const getCollection: typeof Astro.getCollection = () => {
  throw new Error("Astro content reads are unavailable in the queue consumer");
};

export const render: typeof Astro.render = () => {
  throw new Error("Astro content rendering is unavailable in the queue consumer");
};
