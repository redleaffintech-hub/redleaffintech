/**
 * Shared between the two server pages (new/edit) and the client form itself.
 *
 * Deliberately NOT in employee-form.tsx: that file is "use client", and a plain
 * function exported from a client module becomes a client reference — a server
 * component can render it as a component but can never call it directly. Both
 * /new and /[id]/edit build this shape on the server, so it lives here instead.
 */
export interface EmployeeFormValues {
  id?: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string;
  dateOfBirth: string;
  personalEmail: string;
  personalPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  sinMasked: string | null;
  jobTitle: string;
  departmentId: string;
  managerId: string;
  provinceOfEmployment: string;
  employeeType: string;
  hireDate: string;
  compensationType: string;
  payRate: string;
  payFrequency: string;
  standardHoursPerWeek: string;
  notes: string;
}

export function blankEmployee(companyProvince: string): EmployeeFormValues {
  return {
    legalFirstName: "", legalLastName: "", preferredName: "", dateOfBirth: "",
    personalEmail: "", personalPhone: "",
    addressLine1: "", addressLine2: "", city: "", province: "", postalCode: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "",
    sinMasked: null,
    jobTitle: "", departmentId: "", managerId: "",
    provinceOfEmployment: companyProvince, employeeType: "FULL_TIME", hireDate: "",
    compensationType: "SALARY", payRate: "", payFrequency: "BIWEEKLY", standardHoursPerWeek: "40",
    notes: "",
  };
}
