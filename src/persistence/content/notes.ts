import { getCollection } from "virtual:astro";

export function readNotes() {
  return getCollection("notes");
}
