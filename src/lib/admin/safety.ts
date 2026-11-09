import { DEMO_MODE } from "@/lib/demo";

/** Live writes require an explicit opt-in; isolated demo writes stay in memory. */
export function isNewHireDryRun(): boolean {
  return DEMO_MODE
    ? process.env.NEW_HIRE_DRY_RUN === "true"
    : process.env.NEW_HIRE_DRY_RUN !== "false";
}
