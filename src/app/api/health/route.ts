// Liveness only: hosting probes must not wake the database or consume its compute.
export function GET() {
  return Response.json({ status: "ok" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
