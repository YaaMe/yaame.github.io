import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import {
  commentCollectionSchema,
  postCollectionSchema,
  noteCollectionSchema,
  komorebiCollectionSchema,
} from "./selectors/content/collections";
import {
  komorebi as komorebiLocation,
  notes as notesLocation,
  posts as postsLocation,
  promotedComments,
} from "./config/data.config.generated.mjs";

const promotedCommentsGlob = promotedComments.glob;
const notesGlob = notesLocation.glob;
const postsGlob = postsLocation.glob;
const komorebiGlob = komorebiLocation.glob;

export const collections = {
  notes: defineCollection({
    loader: glob(notesGlob),
    schema: noteCollectionSchema,
  }),
  comments: defineCollection({
    loader: glob(promotedCommentsGlob),
    schema: commentCollectionSchema,
  }),
  posts: defineCollection({
    loader: glob(postsGlob),
    schema: postCollectionSchema,
  }),
  komorebi: defineCollection({
    loader: glob(komorebiGlob),
    schema: komorebiCollectionSchema,
  }),
};
