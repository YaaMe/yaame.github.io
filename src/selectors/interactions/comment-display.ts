import { commentHref } from "../../models/content/comments.ts";

export const stamp = (iso: string) => iso.slice(0, 10);
export const safeHref = (value: string) => {
  const parsed = commentHref.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
