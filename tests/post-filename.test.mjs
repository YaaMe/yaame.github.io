import assert from "node:assert/strict";
import test from "node:test";
import { parsePostFilename } from "../src/models/content/post-filename.ts";
import { parsePostFilename as parseAuthoringFilename } from "../src/services/authoring/posts.ts";

test("filename prefixes are independent of complete period matches", () => {
  for (const [filename, yearPrefix] of [
    ["essay", undefined], ["", undefined], ["x2025-year", undefined],
    ["2025essay", "2025"], ["20250", "2025"], ["2025-7", "2025"],
    ["2025-07-extra", "2025"], ["2025-year.md", "2025"],
  ]) {
    assert.deepEqual(parsePostFilename(filename), { yearPrefix, period: null }, filename);
  }
});

test("period matches expose calendar facts without rejecting filename shapes", () => {
  for (const [filename, year, kind, month, day, validMonth, validDay] of [
    ["2025", "2025", "bare", undefined, undefined, false, false],
    ["2025-year", "2025", "year", undefined, undefined, false, false],
    ["2025-year-01", "2025", "year", undefined, "01", false, false],
    ["2025-year-99", "2025", "year", undefined, "99", false, false],
    ["2025-01", "2025", "month", "01", undefined, true, false],
    ["2025-12", "2025", "month", "12", undefined, true, false],
    ["2025-00", "2025", "month", "00", undefined, false, false],
    ["2025-13", "2025", "month", "13", undefined, false, false],
    ["2024-02-29", "2024", "day", "02", "29", true, true],
    ["2000-02-29", "2000", "day", "02", "29", true, true],
    ["1900-02-29", "1900", "day", "02", "29", true, false],
    ["2025-02-29", "2025", "day", "02", "29", true, false],
    ["2025-02-30", "2025", "day", "02", "30", true, false],
    ["2025-04-31", "2025", "day", "04", "31", true, false],
    ["2025-01-00", "2025", "day", "01", "00", true, false],
    ["2025-01-32", "2025", "day", "01", "32", true, false],
    ["2025-13-01", "2025", "day", "13", "01", false, false],
    ["0000-01", "0000", "month", "01", undefined, true, false],
    ["0000-01-01", "0000", "day", "01", "01", true, false],
    ["0099-01-01", "0099", "day", "01", "01", true, false],
    ["0100-01-01", "0100", "day", "01", "01", true, true],
  ]) {
    assert.deepEqual(parsePostFilename(filename), {
      yearPrefix: year,
      period: { year, kind, month, day, validMonth, validDay },
    }, filename);
  }
});

test("the authoring forward imports under plain Node and exposes the parser", () => {
  assert.deepEqual(parseAuthoringFilename("2025-99"), {
    yearPrefix: "2025",
    period: { year: "2025", kind: "month", month: "99", day: undefined, validMonth: false, validDay: false },
  });
});
