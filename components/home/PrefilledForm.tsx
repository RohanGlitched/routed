"use client";

import { useSearchParams } from "next/navigation";
import { RouteForm } from "./RouteForm";

/** The form with ?artist= and ?from= (a "try again" or "route this one instead" link) read in the browser, so the
 *  page itself can be cached. Rendered inside a Suspense boundary whose fallback is the plain form. */
export function PrefilledForm({ artist = "", from = "" }: { artist?: string; from?: string }) {
  const q = useSearchParams();
  return <RouteForm artist={q.get("artist") || artist} from={q.get("from") || from} />;
}
