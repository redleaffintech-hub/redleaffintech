"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  changeMembershipRole,
  createUser,
  forceSignOut,
  grantMembership,
  issuePasswordReset,
  removeMembership,
  setMembershipStatus,
  updateUserProfile,
} from "@/server/admin/users";
import { optionalStr, runAdminAction, str } from "@/server/admin/run-action";

/**
 * User and membership mutations.
 *
 * The two credential actions are the sensitive ones, and both are written so
 * that the secret exists in exactly one place for exactly one moment: it is
 * generated, hashed, stored as a hash, and returned once in the action's
 * `message` for the page to display. It is never logged, never written to the
 * audit trail (`redact()` would catch it, but it is simply never passed), and
 * cannot be retrieved afterwards by anyone, including the administrator who
 * issued it.
 */

export async function createUserAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const method = str(data, "method") === "TEMPORARY" ? "TEMPORARY" : "INVITE";
    const result = await createUser(actor, {
      name: str(data, "name"),
      email: str(data, "email"),
      method,
    });

    revalidatePath("/admin/users");

    if (result.existed) {
      return {
        ok: true,
        message: "An account with that email already exists — no duplicate was created. Open it to grant access.",
      };
    }

    if (result.temporaryPassword) {
      return {
        ok: true,
        message: `User created. Temporary password: ${result.temporaryPassword} — they must change it at first sign-in.`,
      };
    }

    // Outbound email is not wired up in this build, so the link is handed to the
    // operator to pass on. Only its hash is stored.
    return {
      ok: true,
      message: `User created. Invitation token: ${result.inviteToken} — it expires in 72 hours and can be used once.`,
    };
  });
}

export async function updateUserAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const userId = str(data, "userId");
    await updateUserProfile(actor, {
      userId,
      name: str(data, "name"),
      email: str(data, "email"),
    });
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true, message: "Details updated." };
  });
}

export async function resetPasswordAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const userId = str(data, "userId");
    const method = str(data, "method") === "TEMPORARY" ? "TEMPORARY" : "LINK";

    const result = await issuePasswordReset(actor, {
      userId,
      method,
      reason: optionalStr(data, "reason") ?? null,
    });

    revalidatePath(`/admin/users/${userId}`);

    const secret =
      method === "TEMPORARY"
        ? `Temporary password: ${result.temporaryPassword}`
        : `Reset token: ${result.token}`;

    return {
      ok: true,
      message: `${secret} — valid until ${result.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC. Every existing session has been signed out.`,
    };
  });
}

export async function forceSignOutAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const userId = str(data, "userId");
    const count = await forceSignOut(actor, { userId, reason: optionalStr(data, "reason") ?? null });
    revalidatePath(`/admin/users/${userId}`);
    return {
      ok: true,
      message: count === 0 ? "They had no active sessions." : `Signed out of ${count} session${count === 1 ? "" : "s"}.`,
    };
  });
}

// ── Memberships, from the user's own page ───────────────────────────────────

export async function grantMembershipFromUserAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const userId = str(data, "userId");
    const companyName = str(data, "companyName");

    // Companies are addressed by name here, which is how a support conversation
    // refers to them. An ambiguous name is refused rather than guessed.
    const matches = await db.company.findMany({
      where: { name: { equals: companyName, mode: "insensitive" } },
      select: { id: true, name: true },
      take: 2,
    });
    if (matches.length === 0) return { error: `No client company is called "${companyName}".` };
    if (matches.length > 1) {
      return { error: `More than one company is called "${companyName}". Grant access from the client's own page.` };
    }

    await grantMembership(actor, {
      userId,
      companyId: matches[0].id,
      role: str(data, "role"),
    });

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath(`/admin/clients/${matches[0].id}`);
    return { ok: true, message: `Access to ${matches[0].name} granted.` };
  });
}

export async function changeUserRoleAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await changeMembershipRole(actor, {
      membershipId: str(data, "membershipId"),
      role: str(data, "role"),
    });
    revalidatePath(`/admin/users/${str(data, "userId")}`);
    return { ok: true, message: "Role changed." };
  });
}

export async function setUserMembershipStatusAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const status = str(data, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await setMembershipStatus(actor, {
      membershipId: str(data, "membershipId"),
      status,
      reason: optionalStr(data, "reason") ?? null,
    });
    revalidatePath(`/admin/users/${str(data, "userId")}`);
    return { ok: true, message: status === "SUSPENDED" ? "Access suspended." : "Access reactivated." };
  });
}

export async function removeUserMembershipAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await removeMembership(actor, {
      membershipId: str(data, "membershipId"),
      reason: str(data, "reason"),
    });
    revalidatePath(`/admin/users/${str(data, "userId")}`);
    return { ok: true, message: "Access removed." };
  });
}
