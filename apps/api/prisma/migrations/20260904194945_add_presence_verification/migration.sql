-- CreateEnum
CREATE TYPE "PresenceVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'OUTSIDE_GEOFENCE', 'MISSED');

-- CreateTable
CREATE TABLE "presence_verifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT,
    "attendanceRecordId" TEXT NOT NULL,
    "attendanceEventId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "status" "PresenceVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceMeters" DOUBLE PRECISION,
    "geofenceRadiusMeters" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presence_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "presence_verifications_attendanceEventId_key" ON "presence_verifications"("attendanceEventId");

-- CreateIndex
CREATE INDEX "presence_verifications_companyId_status_idx" ON "presence_verifications"("companyId", "status");

-- CreateIndex
CREATE INDEX "presence_verifications_companyId_employeeId_status_idx" ON "presence_verifications"("companyId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "presence_verifications_employeeId_dueAt_idx" ON "presence_verifications"("employeeId", "dueAt");

-- AddForeignKey
ALTER TABLE "presence_verifications" ADD CONSTRAINT "presence_verifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_verifications" ADD CONSTRAINT "presence_verifications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_verifications" ADD CONSTRAINT "presence_verifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_verifications" ADD CONSTRAINT "presence_verifications_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_verifications" ADD CONSTRAINT "presence_verifications_attendanceEventId_fkey" FOREIGN KEY ("attendanceEventId") REFERENCES "attendance_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
