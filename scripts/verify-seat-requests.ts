/**
 * Additional-users flow: limit enforcement, request -> approve/reject, concurrency,
 * and that a plan change keeps paid extras. Local/dev DB only.
 */
import "./load-env";
import { db } from "../src/lib/db";
import { provisionCompany } from "../src/server/setup/provision";
import { assertSeatAvailable, SeatLimitError } from "../src/server/seats/limits";
import { approveSeatRequest, rejectSeatRequest, requestExtraUsers, SeatRequestError } from "../src/server/seats/requests";
import { extraChargeCents } from "../src/lib/seats";

let failures = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failures++; };
const rejects = async (fn: () => Promise<unknown>, type: new (...a: never[]) => Error) => { try { await fn(); return false; } catch (e) { return e instanceof type; } };

async function addMember(companyId: string, n: number) {
  const u = await db.user.create({ data: { email: `zz-seat-${Date.now()}-${n}@probe.test`, name: "P", passwordHash: "x" } });
  await db.$transaction(async (tx) => { await assertSeatAvailable(tx, companyId); await tx.companyUser.create({ data: { companyId, userId: u.id, role: "ACCOUNTANT", status: "ACTIVE" } }); });
  return u;
}

async function main() {
  if (/neon\.tech/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against Neon/production.");
  check("pricing table: 0/1/2/3 extra = $0/$4.99/$9.98/$14.97", [0, 1, 2, 3].map((n) => extraChargeCents(n)).join() === "0,499,998,1497");

  const co = await db.$transaction((tx) => provisionCompany(tx, { name: "ZZ Seat Probe", legalName: "ZZ", province: "ON", country: "CA", baseCurrency: "CAD", fiscalYearStartMonth: 1, plan: "BASIC", billingCycle: "MONTHLY" } as never), { timeout: 60000 });
  await db.subscription.update({ where: { companyId: co.id }, data: { seats: 2 } }); // the default allowance
  const admin = await db.user.create({ data: { email: `zz-admin-${Date.now()}@probe.test`, name: "Adm", passwordHash: "x" } });
  const actor = { id: admin.id, email: admin.email, name: "Adm", mfaEnabled: false, mustChangePassword: false, csrfToken: "" } as never;

  await addMember(co.id, 1); await addMember(co.id, 2);
  check("2 users fit the default limit", (await db.companyUser.count({ where: { companyId: co.id } })) === 2);
  check("a 3rd user is refused without approval", await rejects(() => addMember(co.id, 3), SeatLimitError));

  check("0 / negative / huge requests are refused", (await rejects(() => requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 0 }), SeatRequestError)) && (await rejects(() => requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 999 }), SeatRequestError)));
  const req = await requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 2 });
  check("request records $9.98 for 2 users, still PENDING", req.totalCents === 998 && req.status === "PENDING" && req.usersBefore === 2 && req.seatsBefore === 2);
  check("pending request does not raise the limit", (await db.subscription.findUniqueOrThrow({ where: { companyId: co.id } })).seats === 2);
  check("a second pending request is refused", await rejects(() => requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 1 }), SeatRequestError));

  await approveSeatRequest(actor, req.id);
  const sub = await db.subscription.findUniqueOrThrow({ where: { companyId: co.id } });
  check("approval raises limit 2 -> 4 and records 2 paid extras", sub.seats === 4 && sub.extraSeats === 2);
  check("approving twice is refused (no double grant)", await rejects(() => approveSeatRequest(actor, req.id), SeatRequestError));
  check("company notified of approval", (await db.notification.count({ where: { companyId: co.id, type: "SEAT_REQUEST" } })) === 1);

  await addMember(co.id, 3); await addMember(co.id, 4);
  check("users 3 and 4 now allowed", (await db.companyUser.count({ where: { companyId: co.id } })) === 4);
  check("a 5th is refused again", await rejects(() => addMember(co.id, 5), SeatLimitError));

  // Concurrency: one free seat, two simultaneous invites.
  await db.subscription.update({ where: { companyId: co.id }, data: { seats: 5 } });
  const settled = await Promise.allSettled([addMember(co.id, 6), addMember(co.id, 7)]);
  check("two simultaneous invites for ONE free seat: exactly one wins", settled.filter((s) => s.status === "fulfilled").length === 1 && (await db.companyUser.count({ where: { companyId: co.id } })) === 5);

  const req2 = await requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 1 });
  await rejectSeatRequest(actor, req2.id, "Not this month");
  const rej = await db.userSeatRequest.findUniqueOrThrow({ where: { id: req2.id } });
  check("rejection keeps limit, stores reason, notifies", rej.status === "REJECTED" && rej.decisionNote === "Not this month" && (await db.subscription.findUniqueOrThrow({ where: { companyId: co.id } })).seats === 5 && (await db.notification.count({ where: { companyId: co.id, type: "SEAT_REQUEST" } })) === 2);
  check("rejecting needs a reason", await rejects(async () => { const r = await requestExtraUsers({ companyId: co.id, userId: admin.id, extraUsers: 1 }); await rejectSeatRequest(actor, r.id, "  "); }, SeatRequestError));

  console.log("note: probe company 'ZZ Seat Probe' (+ zz-*@probe.test users) left in the local database.");
  console.log(failures ? `\n${failures} FAILED` : "\nAll seat-request checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
