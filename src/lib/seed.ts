import { hashPassword } from "./auth";
import db from "./db";

async function main() {
  const email = process.env.HOST_EMAIL ?? "demo@slotbook.app";
  const password = process.env.HOST_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HOST_PASSWORD must be configured with at least 12 characters.");
  }

  const host = await db.host.upsert({
    where: { email },
    update: {
      name: "Alex Morgan",
      slug: "demo-host",
      timezone: "Asia/Kolkata",
      passwordHash: await hashPassword(password),
    },
    create: {
      email,
      name: "Alex Morgan",
      slug: "demo-host",
      timezone: "Asia/Kolkata",
      passwordHash: await hashPassword(password),
    },
  });

  const eventDefinitions = [
    {
      name: "Intro Call",
      slug: "intro-call",
      durationMinutes: 30,
      capacity: 1,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      minNoticeMinutes: 60,
      bookingHorizonDays: 30,
      accessWindow: { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
    },
    {
      name: "Office Hours",
      slug: "office-hours",
      durationMinutes: 60,
      capacity: 3,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minNoticeMinutes: 30,
      bookingHorizonDays: 45,
      accessWindow: { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    },
  ];

  for (const event of eventDefinitions) {
    const created = await db.eventType.upsert({
      where: {
        hostId_slug: {
          hostId: host.id,
          slug: event.slug,
        },
      },
      update: {
        name: event.name,
        durationMinutes: event.durationMinutes,
        capacity: event.capacity,
        bufferBeforeMinutes: event.bufferBeforeMinutes,
        bufferAfterMinutes: event.bufferAfterMinutes,
        minNoticeMinutes: event.minNoticeMinutes,
        bookingHorizonDays: event.bookingHorizonDays,
      },
      create: {
        hostId: host.id,
        name: event.name,
        slug: event.slug,
        durationMinutes: event.durationMinutes,
        capacity: event.capacity,
        bufferBeforeMinutes: event.bufferBeforeMinutes,
        bufferAfterMinutes: event.bufferAfterMinutes,
        minNoticeMinutes: event.minNoticeMinutes,
        bookingHorizonDays: event.bookingHorizonDays,
      },
    });

    await db.availabilityRule.upsert({
      where: {
        id: `rule-${created.id}-${event.accessWindow.dayOfWeek}`,
      },
      update: {
        startMinute: event.accessWindow.startMinute,
        endMinute: event.accessWindow.endMinute,
      },
      create: {
        id: `rule-${created.id}-${event.accessWindow.dayOfWeek}`,
        eventTypeId: created.id,
        dayOfWeek: event.accessWindow.dayOfWeek,
        startMinute: event.accessWindow.startMinute,
        endMinute: event.accessWindow.endMinute,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect().catch(() => undefined);
  });
