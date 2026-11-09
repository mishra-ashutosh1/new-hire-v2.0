import { DEMO_MODE } from "@/lib/demo";
import { isNewHireDryRun } from "@/lib/admin/safety";

/** POC authentication bypass is never permitted for live upstream writes. */
export const POC_MODE_ENABLED =
  process.env.NEW_HIRE_POC_MODE === "true" && (DEMO_MODE || isNewHireDryRun());

/** Used only for isolated demo activity; live operations require a session. */
export const POC_ACTOR_EMAIL = "poc@local";
