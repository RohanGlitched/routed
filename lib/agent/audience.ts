import type { AgeBucket, Audience } from "../types";

export const AGE_LABEL: Record<AgeBucket, string> = {
  "24_and_younger": "24 and under",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55 and over",
};

export const AGE_ORDER = Object.keys(AGE_LABEL) as AgeBucket[];

/**
 * Door policy from Qloo's age skew, by rule: a fan base that over-indexes on 24-and-under needs all-ages or
 * 18+ rooms, or a big share of it can't get in; one that skews 35+ is fine in 21+ rooms and seated theatres.
 */
export function doorAdvice(age: Audience["age"]): string | undefined {
  const young = age["24_and_younger"];
  const older = (age["35_to_44"] ?? 0) + (age["45_to_54"] ?? 0) + (age["55_and_older"] ?? 0);
  if (young === undefined && !older) return undefined;
  if ((young ?? 0) >= 0.1) return "Fans over-index at 24 and under: ask every room for an all-ages or 18+ show.";
  if ((young ?? 0) > 0) return "Fans lean young: an all-ages or 18+ door keeps the under-21s in.";
  if (older >= 0.15) return "Fans skew 35 and over: 21+ rooms and seated theatres both work; earlier set times help.";
  return "Fans are spread across ages: any door policy works.";
}

/** The strongest over-index, for a headline ("over-indexes 25–29"). */
export function topAge(age: Audience["age"]): { bucket: AgeBucket; value: number } | null {
  let best: { bucket: AgeBucket; value: number } | null = null;
  for (const b of AGE_ORDER) {
    const v = age[b];
    if (v !== undefined && (!best || v > best.value)) best = { bucket: b, value: v };
  }
  return best && best.value > 0 ? best : null;
}
