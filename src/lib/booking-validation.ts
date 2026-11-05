import { IANAZone } from "luxon";
import { z } from "zod";

function requireGuestDetailsTogether(
  details: { guestName?: string; guestEmail?: string },
  context: z.RefinementCtx,
) {
  if ((details.guestName === undefined) !== (details.guestEmail === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Provide both guest name and email, or leave both blank until confirmation.",
      path: ["guestEmail"],
    });
  }
}

export const createHoldRequestSchema = z.object({
  eventTypeId: z.string().min(1),
  start: z.iso.datetime(),
  timezone: z.string().refine(IANAZone.isValidZone, "Invalid IANA timezone."),
  guestName: z.string().trim().min(2).max(120).optional(),
  guestEmail: z.email().max(254).optional(),
}).strict().superRefine(requireGuestDetailsTogether);

export const confirmHoldRequestSchema = z.object({
  guestName: z.string().trim().min(2).max(120).optional(),
  guestEmail: z.email().max(254).optional(),
}).strict().superRefine(requireGuestDetailsTogether);
