import { TIME_ZONE } from "@/lib/utils";

/** Today as YYYY-MM-DD in the help desk's time zone. */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

function dayNumber(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `today` to `iso` (negative when overdue). */
export function daysUntil(iso: string, today = todayISO()) {
  return dayNumber(iso) - dayNumber(today);
}

/** "Today", "Tomorrow", "Fri", "Nov 20", "Jan 3, 2027" and how urgent it looks. */
export function dueLabel(iso: string, today = todayISO()) {
  const n = daysUntil(iso, today);
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  let label: string;
  if (n === 0) label = "Today";
  else if (n === 1) label = "Tomorrow";
  else if (n === -1) label = "Yesterday";
  else if (n > 1 && n < 7) label = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  else
    label = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    });
  const tone: "overdue" | "soon" | "later" = n < 0 ? "overdue" : n <= 1 ? "soon" : "later";
  return { label, tone };
}
