import { ModelRouter } from "@/lib/models/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModelHealthCheck } from "@/components/settings/health-check";

export const dynamic = "force-dynamic";

export default async function ModelsSettings() {
  const status = ModelRouter.status();
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ResearchOS routes every agent purpose through a provider abstraction. Configuration
            is read from environment variables — restart the worker after editing them.
          </p>
        </header>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Anthropic</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={status.anthropic.configured ? "success" : "warning"}>
                  {status.anthropic.configured ? "configured" : "needs key"}
                </Badge>
                <Badge variant="outline" className="mono">
                  {status.anthropic.model}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-3">
              All agent purposes (planning, safety, retrieval synthesis, generation, critique,
              verification, debate judge, evolution, completion, final report) currently route
              through Anthropic.
            </div>
            <ModelHealthCheck />
            <pre className="mt-4 text-[11px] mono bg-black/40 border border-border rounded-md p-3 overflow-x-auto">
              {`# .env
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=${status.anthropic.model}`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Other providers</CardTitle>
              <Badge variant="muted">future</Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The <code className="mono text-[12px]">ModelProvider</code> interface is provider-agnostic.
            Additional providers (e.g. cheaper safety classifiers, alternative final-report
            models) can be added in <code className="mono text-[12px]">src/lib/models/</code> and
            routed via <code className="mono text-[12px]">ModelRouter.for(purpose)</code>.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
