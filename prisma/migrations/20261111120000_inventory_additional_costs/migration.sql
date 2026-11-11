-- Additional inventory costs (capitalised repairs, detailing, inspection on a unit already in stock)
-- and an optional VIN / serial number on catalogue items.
-- Additive: three nullable columns, no data change.

ALTER TABLE "ServiceItem" ADD COLUMN "vin" TEXT;

ALTER TABLE "InventoryMovement" ADD COLUMN "costCategory" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "supplierName" TEXT;
