export function parsePostFilename(filename: string): {
  yearPrefix: string | undefined;
  period: {
    year: string;
    kind: "bare" | "year" | "month" | "day";
    month: string | undefined;
    day: string | undefined;
    validMonth: boolean;
    validDay: boolean;
  } | null;
} {
  const yearPrefix = /^(\d{4})/.exec(filename)?.[1];
  const match = /^(\d{4})(?:-(\d{2}|year)(?:-(\d{2}))?)?$/.exec(filename);
  if (!match) return { yearPrefix, period: null };

  const [, year, segment, day] = match;
  const kind = segment === undefined ? "bare"
    : segment === "year" ? "year"
    : day === undefined ? "month" : "day";
  const month = kind === "month" || kind === "day" ? segment : undefined;
  const monthNumber = month === undefined ? undefined : Number(month);
  return {
    yearPrefix,
    period: {
      year,
      kind,
      month,
      day,
      validMonth: monthNumber !== undefined && monthNumber >= 1 && monthNumber <= 12,
      validDay: monthNumber !== undefined && day !== undefined && isRealDay(Number(year), monthNumber, Number(day)),
    },
  };
}

/** A real calendar day, so 2026-02-30 is rejected rather than filed. */
function isRealDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
