import type { Job } from "./workshopTypes";
import { getWorkV2LogText } from "./workV2TextHelpers";

export function getWorkV2LogSuffix(job: Job): string {
  return getWorkV2LogText(job);
}