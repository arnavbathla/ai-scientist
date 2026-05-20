import { SOURCE_REGISTRY, DEFAULT_SOURCE_CONFIG } from "@/lib/sources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceHealthCheck } from "@/components/settings/health-check";

export const dynamic = "force-dynamic";

export default async function SourcesSettings() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scientific source tools. Per-run configuration is set when you create a run; this page
            shows the registry and defaults.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceHealthCheck />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(SOURCE_REGISTRY).map(([id, def]) => {
            const cfg = DEFAULT_SOURCE_CONFIG[id as keyof typeof DEFAULT_SOURCE_CONFIG];
            return (
              <Card key={id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{def.label}</CardTitle>
                    <Badge variant={cfg?.enabled ? "success" : "muted"}>
                      {cfg?.enabled ? "default on" : "default off"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div>{def.description}</div>
                  <div className="mono text-[10px]">id: {id} · default max results: {cfg?.maxResults}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
