/**
 * The password policy, in one place so the form and the server agree.
 *
 * Length does most of the work; the character-class rule exists only to stop
 * twelve characters of one repeated letter. There is deliberately no maximum
 * short of a sanity limit and no forced rotation — both push people towards
 * worse passwords, not better ones.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export interface PasswordVerdict {
  ok: boolean;
  problems: string[];
}

export function checkPassword(password: string, context: { email?: string; name?: string } = {}): PasswordVerdict {
  const problems: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Keep it under ${MAX_PASSWORD_LENGTH} characters.`);
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) {
    problems.push("Mix at least three of: lower case, upper case, digits, symbols.");
  }

  if (/^(.)\1+$/.test(password)) {
    problems.push("That is the same character repeated.");
  }

  const lower = password.toLowerCase();
  const localPart = context.email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    problems.push("Do not build the password out of your email address.");
  }
  if (context.name) {
    const firstName = context.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (firstName && firstName.length >= 4 && lower.includes(firstName)) {
      problems.push("Do not build the password out of your name.");
    }
  }

  return { ok: problems.length === 0, problems };
}
