"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const DOMAINS = [
  "General biology",
  "Drug discovery",
  "Genetics",
  "Protein science",
  "Chemistry",
  "Materials science",
  "Aging research",
  "Disease mechanism",
  "Other",
];

const SOURCE_LABELS: { id: string; label: string }[] = [
  { id: "pubmed", label: "PubMed" },
  { id: "openalex", label: "OpenAlex" },
  { id: "crossref", label: "Crossref" },
  { id: "chembl", label: "ChEMBL" },
  { id: "uniprot", label: "UniProt" },
  { id: "alphafold", label: "AlphaFold DB" },
];

interface NewRunButtonProps {
  projectId: string;
  defaultDomain?: string;
}

export function NewRunButton({ projectId, defaultDomain }: NewRunButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [goal, setGoal] = useState("");
  const [domain, setDomain] = useState(defaultDomain ?? "General biology");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [maxIterations, setMaxIterations] = useState<number>(25);
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState<number>(180);
  const [maxSources, setMaxSources] = useState<number>(100);
  const [maxHypotheses, setMaxHypotheses] = useState<number>(40);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>({
    pubmed: true,
    openalex: true,
    crossref: true,
    chembl: false,
    uniprot: false,
    alphafold: false,
  });
  const [organisms, setOrganisms] = useState("");
  const [genes, setGenes] = useState("");
  const [proteins, setProteins] = useState("");
  const [diseases, setDiseases] = useState("");
  const [pathways, setPathways] = useState("");
  const [compounds, setCompounds] = useState("");
  const [excluded, setExcluded] = useState("");

  const onRun = () => {
    setError(null);
    startTransition(async () => {
      const sourceConfig: Record<string, { enabled: boolean }> = {};
      for (const s of SOURCE_LABELS) sourceConfig[s.id] = { enabled: !!sourceEnabled[s.id] };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          researchGoal: goal,
          domain,
          maxIterations,
          maxRuntimeMinutes,
          maxSources,
          maxHypotheses,
          sourceConfig,
          constraints: clean({
            organisms: csv(organisms),
            genes: csv(genes),
            proteins: csv(proteins),
            diseases: csv(diseases),
            pathways: csv(pathways),
            compounds: csv(compounds),
            excludedDirections: csv(excluded),
          }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not start run.");
        return;
      }
      const json = await res.json();
      setOpen(false);
      router.push(`/runs/${json.run.id}`);
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> New run
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-2xl bg-card border border-border rounded-md shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="text-sm font-medium tracking-tight">New research run</div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <Label htmlFor="goal">Research goal</Label>
                <Textarea
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={5}
                  placeholder="e.g. Identify plausible, testable gene-regulatory hypotheses that could improve cellular rejuvenation markers in human fibroblasts."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domain">Domain</Label>
                <select
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Advanced
              </button>

              {showAdvanced && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <NumField label="Max iterations" value={maxIterations} setValue={setMaxIterations} min={1} max={200} />
                    <NumField label="Max runtime (min)" value={maxRuntimeMinutes} setValue={setMaxRuntimeMinutes} min={1} max={1440} />
                    <NumField label="Max sources" value={maxSources} setValue={setMaxSources} min={5} max={500} />
                    <NumField label="Max hypotheses" value={maxHypotheses} setValue={setMaxHypotheses} min={3} max={200} />
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Sources</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {SOURCE_LABELS.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={sourceEnabled[s.id] ?? false}
                            onChange={(e) =>
                              setSourceEnabled((p) => ({ ...p, [s.id]: e.target.checked }))
                            }
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Constraints (comma-separated)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <CsvField label="Organisms" value={organisms} setValue={setOrganisms} />
                      <CsvField label="Genes" value={genes} setValue={setGenes} />
                      <CsvField label="Proteins" value={proteins} setValue={setProteins} />
                      <CsvField label="Diseases" value={diseases} setValue={setDiseases} />
                      <CsvField label="Pathways" value={pathways} setValue={setPathways} />
                      <CsvField label="Compounds" value={compounds} setValue={setCompounds} />
                      <div className="col-span-2">
                        <CsvField label="Excluded directions" value={excluded} setValue={setExcluded} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-400 mono">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={onRun} disabled={pending || goal.trim().length < 12}>
                {pending ? "Starting..." : "Run"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NumField({
  label,
  value,
  setValue,
  min,
  max,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
      />
    </div>
  );
}

function CsvField({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (s: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="comma separated" />
    </div>
  );
}

function csv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function clean<T extends Record<string, string[] | undefined>>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.length > 0) (out as Record<string, string[]>)[k] = v;
  }
  return out;
}
