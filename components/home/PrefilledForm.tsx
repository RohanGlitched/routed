"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { RouteForm } from "./RouteForm";

/** The form with ?artist=, ?from= and ?draw= (a "try again", "route this one instead" or "change the assumed
 *  crowd" link) read in the browser, so the page itself can be cached. Rendered inside a Suspense boundary whose
 *  fallback is the plain form. */
export function PrefilledForm({ artist = "", from = "", aside }: { artist?: string; from?: string; aside?: ReactNode }) {
  const q = useSearchParams();
  return <RouteForm artist={q.get("artist") || artist} from={q.get("from") || from} draw={q.get("draw") ?? ""} aside={aside} />;
}
