// Core stop+upload+release-lock logic for the Vintage Story server, extracted
// from ServerView so it can also be invoked from places like the app close
// guard or the auto-updater banner — paths where the server might still be
// running and we need to flush its save to the cloud before the app dies.
//
// This module is intentionally UI-agnostic. Callers provide an `onStage`
// callback to surface progress and decide how to render the outcome.

import { pb, rpc, getErrorMessage, requirePbUrl, type World } from "@/lib/pocketbase";
import type { PbSession } from "@/hooks/useAuth";
import * as tauri from "@/lib/tauri";
import type { Settings, ServerProfile } from "@/lib/types";

export type StopStage =
  | "stopping"
  | "readingSave"
  | "buildingManifest"
  | "uploading"
  | "releasingLock";

export type StopOutcome =
  | { kind: "localSuccess" }
  | { kind: "groupSuccess"; worldName: string }
  | { kind: "groupSessionExpiredFallback" }
  | { kind: "groupNoSaveFound" }
  | { kind: "failed"; error: string };

export interface StopDeps {
  settings: Settings;
  activeProfile: ServerProfile | null;
  session: PbSession | null;
  onStatusChange: () => void;
  onProfilesChange?: () => void;
}

export interface StopOptions {
  onStage?: (stage: StopStage | null) => void;
}

/**
 * Stops the server cleanly. In group mode this means: stop server (which
 * triggers VS's flush of the .vcdbs), wait, read the save, build the mods
 * manifest, upload to cloud, register the save in the profile, release the
 * lock. In local mode this is just `tauri.stopServer`.
 *
 * Returns a discriminated outcome so the caller can choose whether to toast,
 * show a dialog, or proceed silently. Never throws — failures are encoded in
 * the result.
 */
export async function performServerStop(
  deps: StopDeps,
  options: StopOptions = {}
): Promise<StopOutcome> {
  const { settings, activeProfile, session, onStatusChange, onProfilesChange } = deps;
  const onStage = options.onStage ?? (() => undefined);
  const linkedWorldId = activeProfile?.linked_group_world_id ?? null;

  // Local mode
  if (!linkedWorldId) {
    onStage("stopping");
    try {
      await tauri.stopServer();
      onStatusChange();
      return { kind: "localSuccess" };
    } catch (e) {
      return { kind: "failed", error: getErrorMessage(e) };
    } finally {
      onStage(null);
    }
  }

  // Group mode but no session — fall back to stopping locally without upload
  // so we don't leave the server eternally running. Caller should warn the
  // user about the missing upload.
  if (!session) {
    onStage("stopping");
    try {
      await tauri.stopServer();
      onStatusChange();
      return { kind: "groupSessionExpiredFallback" };
    } catch (e) {
      return { kind: "failed", error: getErrorMessage(e) };
    } finally {
      onStage(null);
    }
  }

  try {
    onStage("stopping");
    await tauri.stopServer();
    onStatusChange();

    // Let the filesystem catch up to VS's final autosave flush
    await new Promise((r) => setTimeout(r, 1500));

    onStage("readingSave");
    let world: World;
    try {
      world = await pb.collection("worlds").getOne<World>(linkedWorldId, {
        fields: "id,name,current_version",
      });
    } catch {
      return { kind: "failed", error: "World no longer exists" };
    }

    const safeName = world.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const savePath = `${settings.data_path}\\Saves\\${safeName}.vcdbs`;

    onStage("buildingManifest");
    let modsManifest: { version: string; mods: { modid: string; name: string; version: string }[] } = {
      version: "1.0",
      mods: [],
    };
    try {
      const installed = await tauri.listInstalledMods(`${settings.data_path}\\Mods`);
      modsManifest = {
        version: "1.0",
        mods: installed.map((m) => ({
          modid: m.modid,
          name: m.name,
          version: m.version,
        })),
      };
    } catch (e) {
      console.warn("[stop] could not read mods, manifest will be empty", e);
    }

    onStage("uploading");
    // Importante: NO usar world.current_version + 1. Ese campo lo bumpea el
    // hook onRecordAfterCreateSuccess y puede quedar desfasado del MAX real
    // de world_versions, causando colision con el indice unico (world, version)
    // → 400 "Failed to create record" con data: {} → todo el progreso de la
    // sesion se pierde porque current_version no avanza y el siguiente start
    // descarga la version vieja. nextWorldVersion computa MAX(version)+1 real
    // dentro de una transaccion server-side.
    let nextVersion: number;
    try {
      const nv = await rpc.nextWorldVersion(world.id);
      nextVersion = nv.next_version;
    } catch (e) {
      console.warn("[stop] nextWorldVersion RPC failed, falling back to world.current_version + 1", e);
      nextVersion = world.current_version + 1;
    }
    const token = pb.authStore.token;
    const userId = pb.authStore.record?.id;
    if (!token || !userId) {
      return { kind: "failed", error: "Not authenticated" };
    }
    await tauri.uploadSaveToCloud({
      savePath,
      pbUrl: requirePbUrl(),
      token,
      worldId: world.id,
      version: nextVersion,
      userId,
      modsManifest,
    });

    if (activeProfile?.id) {
      try {
        await tauri.registerGroupSave(activeProfile.id, {
          world_id: world.id,
          world_name: world.name,
          filename: `${safeName}.vcdbs`,
        });
        onProfilesChange?.();
      } catch (e) {
        console.warn("[group] could not register save in profile", e);
      }
    }

    onStage("releasingLock");
    await rpc.releaseWorldLock(world.id);

    return { kind: "groupSuccess", worldName: world.name };
  } catch (err) {
    const msg = getErrorMessage(err);
    // VS never produced the .vcdbs (early crash, server started+stopped before
    // generating the world). Release the lock so the user is not stuck for
    // 15 min, but flag the outcome so the caller can warn.
    if (msg.includes("Save file not found")) {
      try {
        await rpc.releaseWorldLock(linkedWorldId);
      } catch (releaseErr) {
        console.warn("[group] failed to release lock after missing save", releaseErr);
      }
      return { kind: "groupNoSaveFound" };
    }
    return { kind: "failed", error: msg };
  } finally {
    onStage(null);
  }
}
