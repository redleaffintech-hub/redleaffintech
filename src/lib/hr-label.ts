/**
 * HR and payroll share one navigation tab. When a company has HR but not the Payroll
 * module, calling that tab "Payroll" is wrong: there is no payroll to run.
 */
export function hrSectionLabel(enabledModules: string[]): string {
  return enabledModules.includes("PAYROLL") ? "Payroll" : "HR";
}
