import { auth } from "@/lib/auth/auth";
import { NextResponse } from "next/server";
import { HttpError, unauthorized, forbidden, notFound, badRequest } from "@/lib/auth/errors";

export { HttpError, unauthorized, forbidden, notFound, badRequest };

/**
 * Server-only helper: returns the authenticated user id or throws.
 * Use inside route handlers / RSC.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw unauthorized();
  }
  return session.user.id;
}

export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Wraps a route handler and converts HttpError into JSON responses. */
export function withApiErrors<T extends (...args: any[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      // eslint-disable-next-line no-console
      console.error("[api]", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  }) as T;
}
