-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
