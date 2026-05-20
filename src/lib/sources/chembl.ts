import { fetchWithRetry } from "./http";
import type { NormalizedDocument, SourceHealth, SourceSearchInput, SourceSearchResult } from "./types";

/**
 * ChEMBL molecule + target search.
 * Docs: https://www.ebi.ac.uk/chembl/api/data
 *
 * We surface ChEMBL hits as normalized SourceDocuments with the JSON payload in
 * `raw` so downstream agents can reason about molecules / targets / activities.
 */
const BASE = "https://www.ebi.ac.uk/chembl/api/data";

export async function chemblSearch(input: SourceSearchInput): Promise<SourceSearchResult> {
  const limit = Math.min(input.limit ?? 10, 25);
  const failures: SourceSearchResult["failures"] = [];
  const documents: NormalizedDocument[] = [];

  // Molecule search via "molecule.json?pref_name__icontains=..."
  try {
    const url = `${BASE}/molecule.json?pref_name__icontains=${encodeURIComponent(input.query)}&limit=${limit}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    const molecules = Array.isArray(json?.molecules) ? json.molecules : [];
    for (const m of molecules) {
      const name = m?.pref_name || m?.molecule_chembl_id || "Unnamed molecule";
      const id = m?.molecule_chembl_id as string | undefined;
      documents.push({
        sourceType: "chembl",
        title: `Molecule: ${name}`,
        abstract:
          `Max phase: ${m?.max_phase ?? "n/a"}. ` +
          `First approval: ${m?.first_approval ?? "n/a"}. ` +
          `Molecule type: ${m?.molecule_type ?? "n/a"}.`,
        url: id ? `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/` : undefined,
        raw: { kind: "molecule", ...m },
      });
    }
  } catch (err) {
    failures.push({ source: "chembl.molecule", message: err instanceof Error ? err.message : String(err) });
  }

  // Target search
  try {
    const url = `${BASE}/target.json?pref_name__icontains=${encodeURIComponent(input.query)}&limit=${limit}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { acceptHeader: "application/json" });
    const json = (await res.json()) as any;
    const targets = Array.isArray(json?.targets) ? json.targets : [];
    for (const t of targets) {
      const name = t?.pref_name || t?.target_chembl_id || "Unnamed target";
      const id = t?.target_chembl_id as string | undefined;
      documents.push({
        sourceType: "chembl",
        title: `Target: ${name}`,
        abstract:
          `Type: ${t?.target_type ?? "n/a"}. ` +
          `Organism: ${t?.organism ?? "n/a"}. ` +
          `Components: ${Array.isArray(t?.target_components) ? t.target_components.length : 0}.`,
        url: id ? `https://www.ebi.ac.uk/chembl/target_report_card/${id}/` : undefined,
        raw: { kind: "target", ...t },
      });
    }
  } catch (err) {
    failures.push({ source: "chembl.target", message: err instanceof Error ? err.message : String(err) });
  }

  return { documents, failures };
}

export async function chemblHealth(): Promise<SourceHealth> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(`${BASE}/status.json`, { method: "GET" }, { acceptHeader: "application/json" });
    return { ok: res.ok, message: res.ok ? "ok" : `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  }
}
