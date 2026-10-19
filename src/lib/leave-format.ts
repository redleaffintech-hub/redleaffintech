/** "80h (10.0d)" for a day/week-based policy, plain "16h" for an hours-based one. */
export function hoursLabel(hours: number, policy: { entitlementUnit: string; hoursPerDay: number }): string {
  const h = `${Number.isInteger(hours) ? hours : hours.toFixed(2)}h`;
  return policy.entitlementUnit === "HOURS" || policy.hoursPerDay <= 0 ? h : `${h} (${(hours / policy.hoursPerDay).toFixed(1)}d)`;
}
