import * as tauri from "./tauri";
import type { InstalledMod } from "./types";

export interface ManifestMod {
  modid: string;
  name: string;
  version: string;
}

export interface ModsManifest {
  version: string;
  mods: ManifestMod[];
}

export interface ModMismatch {
  modid: string;
  name: string;
  localVersion: string;
  manifestVersion: string;
}

export interface ModVerificationResult {
  match: boolean;
  missing: ManifestMod[];
  extra: InstalledMod[];
  mismatched: ModMismatch[];
}

const EMPTY_RESULT: ModVerificationResult = {
  match: true,
  missing: [],
  extra: [],
  mismatched: [],
};

// Extrae el "nombre base" de un modid o filename, sacando version y extension.
// "spyglass_0.6.0.zip" -> "spyglass"
// "carryon-1.5.0.zip"  -> "carryon"
// "BetterRuinsv0.6.2.zip" -> "betterruins"
// "spyglass" -> "spyglass"  (modid ya limpio, queda igual)
//
// Necesario porque algunos manifests viejos (subidos antes del fix del parser
// case-insensitive en Rust) tienen el filename como modid en vez del modid
// real del modinfo.json. Sin esta normalizacion el matching falla y aparece
// el mismo mod como "missing" + "extra" simultaneamente.
function baseModId(modid: string): string {
  return modid
    .toLowerCase()
    .replace(/\.zip$/, "")
    // strip "_1.2.3", "-1.2.3", "v1.2.3", "_v1.2", etc al final
    .replace(/[-_]?v?\d+(\.\d+)*$/, "");
}

export function verifyMods(
  local: InstalledMod[],
  manifest: ModsManifest | null | undefined
): ModVerificationResult {
  if (!manifest || !Array.isArray(manifest.mods)) {
    return EMPTY_RESULT;
  }

  const localById = new Map(local.map((m) => [m.modid.toLowerCase(), m]));
  const manifestById = new Map(
    manifest.mods.map((m) => [m.modid.toLowerCase(), m])
  );

  const missing: ManifestMod[] = [];
  const mismatched: ModMismatch[] = [];

  // Pass 1: matching por modid exacto (caso normal).
  for (const mm of manifest.mods) {
    const lm = localById.get(mm.modid.toLowerCase());
    if (!lm) {
      missing.push(mm);
    } else if (lm.version !== mm.version) {
      mismatched.push({
        modid: mm.modid,
        name: mm.name || lm.name || mm.modid,
        localVersion: lm.version,
        manifestVersion: mm.version,
      });
    }
  }

  const extra: InstalledMod[] = [];
  for (const lm of local) {
    if (!manifestById.has(lm.modid.toLowerCase())) {
      extra.push(lm);
    }
  }

  // Pass 2: fallback por base name. Si un mod quedo en `missing` y otro mod
  // (distinto modid) quedo en `extra` pero comparten el mismo base name,
  // probablemente es el mismo mod con distinta version o con un parser de
  // modinfo distinto. Lo movemos a `mismatched`.
  if (missing.length > 0 && extra.length > 0) {
    const extraByBase = new Map<string, InstalledMod>();
    for (const lm of extra) {
      const base = baseModId(lm.modid);
      // Si el base name termina vacio (modid era solo "1.2.3" o ".zip") lo
      // saltamos: no hay con que matchear.
      if (base.length === 0) continue;
      extraByBase.set(base, lm);
    }

    const stillMissing: ManifestMod[] = [];
    const matchedExtraIds = new Set<string>();

    for (const mm of missing) {
      const base = baseModId(mm.modid);
      const matchedLocal = base.length > 0 ? extraByBase.get(base) : undefined;
      if (matchedLocal) {
        // Misma version? entonces todo OK, no es ni missing ni mismatched.
        if (matchedLocal.version === mm.version) {
          matchedExtraIds.add(matchedLocal.modid.toLowerCase());
        } else {
          mismatched.push({
            modid: mm.modid,
            name: mm.name || matchedLocal.name || mm.modid,
            localVersion: matchedLocal.version,
            manifestVersion: mm.version,
          });
          matchedExtraIds.add(matchedLocal.modid.toLowerCase());
        }
      } else {
        stillMissing.push(mm);
      }
    }

    missing.length = 0;
    missing.push(...stillMissing);

    // Sacar de `extra` los que matchearon en pass 2.
    if (matchedExtraIds.size > 0) {
      const filtered = extra.filter(
        (lm) => !matchedExtraIds.has(lm.modid.toLowerCase())
      );
      extra.length = 0;
      extra.push(...filtered);
    }
  }

  return {
    match: missing.length === 0 && mismatched.length === 0,
    missing,
    extra,
    mismatched,
  };
}

export type ModDownloadStatus = "pending" | "downloading" | "done" | "failed";

export interface ModDownloadProgress {
  modid: string;
  name: string;
  status: ModDownloadStatus;
  error?: string;
}

/**
 * Try to download a list of missing mods to the given Mods folder.
 * Reports progress via the onProgress callback.
 *
 * Strategy per mod:
 *   1. searchMods(modid) - fuzzy search by modid string
 *   2. Find best match (prefer urlalias === modid, else first result)
 *   3. getModDetails(api_modid) - fetch releases
 *   4. Find release with matching version, else use first (latest) release
 *   5. downloadMod(release.mainfile, release.filename, modsPath)
 */
export async function downloadMissingMods(
  missing: ManifestMod[],
  modsPath: string,
  onProgress: (p: ModDownloadProgress) => void
): Promise<{ ok: boolean; failures: ModDownloadProgress[] }> {
  const failures: ModDownloadProgress[] = [];

  for (const m of missing) {
    onProgress({ modid: m.modid, name: m.name, status: "downloading" });
    try {
      const results = await tauri.searchMods(m.modid);
      if (results.length === 0) {
        const err = "Not found in mod database";
        onProgress({ modid: m.modid, name: m.name, status: "failed", error: err });
        failures.push({ modid: m.modid, name: m.name, status: "failed", error: err });
        continue;
      }

      const lower = m.modid.toLowerCase();
      const apiMod =
        results.find((r) => (r.urlalias ?? "").toLowerCase() === lower) ??
        results.find((r) => r.name.toLowerCase() === lower) ??
        results[0];

      const details = await tauri.getModDetails(String(apiMod.modid));
      if (!details.releases || details.releases.length === 0) {
        const err = "Mod has no releases";
        onProgress({ modid: m.modid, name: m.name, status: "failed", error: err });
        failures.push({ modid: m.modid, name: m.name, status: "failed", error: err });
        continue;
      }

      const exact = details.releases.find((r) => r.modversion === m.version);
      const release = exact ?? details.releases[0];

      await tauri.downloadMod(release.mainfile, release.filename, modsPath);
      onProgress({ modid: m.modid, name: m.name, status: "done" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onProgress({ modid: m.modid, name: m.name, status: "failed", error: errMsg });
      failures.push({ modid: m.modid, name: m.name, status: "failed", error: errMsg });
    }
  }

  return { ok: failures.length === 0, failures };
}
