import { prisma } from "@/lib/db/prisma";
import { requireUserId, HttpError } from "@/lib/auth/session";
import { getRunForUser } from "@/lib/runs/service";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

/**
 * Server-Sent Events stream for a run's recent events. Long-running, so we
 * don't wrap with withApiErrors. The client reconnects automatically on idle.
 */
export async function GET(req: Request, ctx: Ctx) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof HttpError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
  const { id } = await ctx.params;
  try {
    await getRunForUser(id, userId);
  } catch (err) {
    if (err instanceof HttpError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }

  const url = new URL(req.url);
  let lastEventId: string | null = url.searchParams.get("sinceId");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, idForResume?: string) => {
        try {
          if (idForResume) controller.enqueue(encoder.encode(`id: ${idForResume}\n`));
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed
        }
      };

      send("hello", { runId: id, time: new Date().toISOString() });

      // Send initial snapshot of recent events.
      try {
        const initial = await prisma.agentEvent.findMany({
          where: { runId: id, ...(lastEventId ? { id: { gt: lastEventId } } : {}) },
          orderBy: { createdAt: "asc" },
          take: 100,
        });
        for (const e of initial) {
          send("event", e, e.id);
          lastEventId = e.id;
        }
      } catch {
        // ignore initial fetch errors
      }

      let heartbeat = 0;
      const interval = setInterval(async () => {
        if (closed) return;
        try {
          heartbeat++;
          // Poll for new events. SSE polling avoids needing Postgres LISTEN/NOTIFY infra.
          const next = await prisma.agentEvent.findMany({
            where: { runId: id, ...(lastEventId ? { id: { gt: lastEventId } } : {}) },
            orderBy: { createdAt: "asc" },
            take: 60,
          });
          for (const e of next) {
            send("event", e, e.id);
            lastEventId = e.id;
          }
          // Also push run status snapshot every ~5s
          if (heartbeat % 5 === 0) {
            const fresh = await prisma.researchRun.findUnique({
              where: { id },
              select: {
                status: true,
                completionConfidence: true,
                updatedAt: true,
              },
            });
            const sess = await prisma.agentSession.findFirst({
              where: { runId: id },
              orderBy: { createdAt: "desc" },
              select: { iterationCount: true, currentPhase: true, lastHeartbeatAt: true, status: true },
            });
            send("snapshot", { run: fresh, session: sess });
          }
          // Heartbeat ping every iteration
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // best-effort
        }
      }, 1000);

      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      req.signal.addEventListener("abort", abort);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
