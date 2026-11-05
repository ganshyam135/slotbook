CREATE TYPE "BookingStatus" AS ENUM ('held', 'confirmed', 'cancelled', 'expired');

CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventType_durationMinutes_check" CHECK ("durationMinutes" BETWEEN 15 AND 120),
    CONSTRAINT "EventType_capacity_check" CHECK ("capacity" >= 1),
    CONSTRAINT "EventType_bufferBeforeMinutes_check" CHECK ("bufferBeforeMinutes" BETWEEN 0 AND 30),
    CONSTRAINT "EventType_bufferAfterMinutes_check" CHECK ("bufferAfterMinutes" BETWEEN 0 AND 30),
    CONSTRAINT "EventType_minNoticeMinutes_check" CHECK ("minNoticeMinutes" >= 0),
    CONSTRAINT "EventType_bookingHorizonDays_check" CHECK ("bookingHorizonDays" >= 1)
);

CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AvailabilityRule_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
    CONSTRAINT "AvailabilityRule_minute_range_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440)
);

CREATE TABLE "AvailabilityOverride" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "isUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AvailabilityOverride_window_check" CHECK (
      ("isUnavailable" = true AND "startMinute" IS NULL AND "endMinute" IS NULL)
      OR
      ("isUnavailable" = false AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL
        AND "startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440)
    )
);

CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'held',
    "startUtc" TIMESTAMPTZ(3) NOT NULL,
    "endUtc" TIMESTAMPTZ(3) NOT NULL,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "managementTokenHash" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Booking_interval_check" CHECK ("endUtc" > "startUtc"),
    CONSTRAINT "Booking_hold_expiry_check" CHECK ("status" <> 'held' OR "expiresAt" IS NOT NULL)
);

CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Host_email_key" ON "Host"("email");
CREATE UNIQUE INDEX "Host_slug_key" ON "Host"("slug");
CREATE UNIQUE INDEX "EventType_hostId_slug_key" ON "EventType"("hostId", "slug");
CREATE INDEX "AvailabilityRule_eventTypeId_dayOfWeek_idx" ON "AvailabilityRule"("eventTypeId", "dayOfWeek");
CREATE UNIQUE INDEX "AvailabilityOverride_eventTypeId_localDate_key" ON "AvailabilityOverride"("eventTypeId", "localDate");
CREATE UNIQUE INDEX "Booking_managementTokenHash_key" ON "Booking"("managementTokenHash");
CREATE INDEX "Booking_eventTypeId_status_startUtc_endUtc_idx" ON "Booking"("eventTypeId", "status", "startUtc", "endUtc");
CREATE INDEX "Booking_hostId_status_idx" ON "Booking"("hostId", "status");
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

ALTER TABLE "EventType" ADD CONSTRAINT "EventType_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
