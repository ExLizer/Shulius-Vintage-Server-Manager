import PocketBase, { type RecordModel } from "pocketbase";

// ============================================================
// URL del servidor configurable en runtime (open source friendly)
//
// Orden de resolución:
//   1. localStorage (elegida por el usuario en el setup wizard / Settings)
//   2. VITE_PB_URL (default opcional horneado en build — útil para builds
//      "oficiales" que apuntan a un servidor hosteado y para `npm run dev`)
//   3. null → la nube queda sin configurar; la app funciona en modo local
//      y el wizard de primer inicio ofrece configurarla.
// ============================================================

const STORAGE_KEY = "vsm.pb_url";

// Host placeholder para poder construir el singleton antes del setup.
// `.invalid` es un TLD reservado (RFC 2606): nunca resuelve.
const UNCONFIGURED_URL = "http://pocketbase-not-configured.invalid";

/** Normaliza una URL ingresada por el usuario. Lanza si no es una URL válida. */
export function normalizePbUrl(raw: string): string {
    let u = raw.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const parsed = new URL(u); // throws si es inválida
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return u;
}

function readStoredUrl(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
        return null;
    }
}

const envDefault = (import.meta.env.VITE_PB_URL as string | undefined) || undefined;

let currentUrl: string | null =
    readStoredUrl() ?? (envDefault ? envDefault.trim().replace(/\/+$/, "") : null);

/** URL actual del servidor PocketBase, o null si la nube no está configurada. */
export function getPbUrl(): string | null {
    return currentUrl;
}

export function isPbConfigured(): boolean {
    return currentUrl !== null;
}

/**
 * Como getPbUrl() pero lanza si la nube no está configurada. Para flujos
 * que solo son alcanzables con sesión iniciada (upload/download de mundos).
 */
export function requirePbUrl(): string {
    if (!currentUrl) throw new Error("Cloud server not configured");
    return currentUrl;
}

export const pb = new PocketBase(currentUrl ?? UNCONFIGURED_URL);

// El SDK de PocketBase persiste el authStore en localStorage por defecto.
pb.autoCancellation(false);

/**
 * Fija y persiste la URL del servidor. Si cambia de servidor, limpia la
 * sesión: un token emitido por una instancia no es válido en otra.
 */
export function setPbUrl(raw: string): string {
    const url = normalizePbUrl(raw);
    const changed = currentUrl !== null && currentUrl !== url;
    currentUrl = url;
    try {
        localStorage.setItem(STORAGE_KEY, url);
    } catch {
        // localStorage no disponible: la URL vive solo en memoria esta sesión
    }
    pb.baseUrl = url;
    if (changed) pb.authStore.clear();
    return url;
}

/** Borra la configuración de nube (vuelve al estado "sin configurar"). */
export function clearPbUrl(): void {
    currentUrl = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore
    }
    pb.authStore.clear();
    pb.baseUrl = UNCONFIGURED_URL;
}

export function getErrorMessage(err: unknown): string {
    if (!err) return "Unknown error";
    if (err instanceof Error) {
        // PocketBase ClientResponseError pone el detalle en .data.message o .data.data
        const anyErr = err as Error & {
            data?: { message?: string; data?: Record<string, { message?: string }> };
            status?: number;
        };
        if (anyErr.data?.message) {
            const fields = anyErr.data.data;
            if (fields && typeof fields === "object") {
                const parts: string[] = [];
                for (const k of Object.keys(fields)) {
                    const v = fields[k];
                    if (v && typeof v.message === "string") parts.push(`${k}: ${v.message}`);
                }
                if (parts.length > 0) return `${anyErr.data.message} — ${parts.join("; ")}`;
            }
            return anyErr.data.message;
        }
        return err.message;
    }
    if (typeof err === "object") {
        try { return JSON.stringify(err); } catch { /* ignore */ }
    }
    return String(err);
}

export async function withTimeout<T>(
    promise: PromiseLike<T>,
    ms: number,
    label: string
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timeout (${ms}ms) en ${label}`)),
            ms
        );
    });
    try {
        return (await Promise.race([Promise.resolve(promise), timeoutPromise])) as T;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ============================================================
// Tipos de las collections (matchean exactamente el schema PB)
// ============================================================

export type UserRecord = RecordModel & {
    email: string;
    name: string;          // display_name
    avatar: string;        // file id o ""
    verified: boolean;
    cloud_enabled: boolean;
    max_upload_bytes: number;
};

// Vista "Profile" simplificada para uso en UI. display_name y avatar_url
// son derivados — name -> display_name, avatar -> URL absoluta.
export type Profile = {
    id: string;
    display_name: string;
    avatar_url: string | null;
    created: string;
};

export function userToProfile(u: UserRecord | RecordModel | null | undefined): Profile | null {
    if (!u) return null;
    const r = u as UserRecord;
    return {
        id: r.id,
        display_name: r.name || r.email || r.id.slice(0, 8),
        avatar_url: r.avatar ? pb.files.getURL(r, r.avatar) : null,
        created: r.created,
    };
}

export type Group = RecordModel & {
    name: string;
    discriminator: string;
    full_tag: string;
    owner: string;
};

export type GroupMember = RecordModel & {
    group: string;
    user: string;
    role: "owner" | "admin" | "player";
    joined_at: string;
    // Expansion (cuando se pide ?expand=user)
    expand?: { user?: UserRecord };
};

export type Invite = RecordModel & {
    code: string;
    group: string;
    created_by: string;
    expires_at: string;
    uses_left: number;
};

export type World = RecordModel & {
    group: string;
    name: string;
    current_holder: string;
    lock_acquired_at: string;
    lock_expires_at: string;
    current_version: number;
    source_filename: string;
};

export type WorldVersion = RecordModel & {
    world: string;
    version: number;
    file: string;
    size_bytes: number;
    mods_manifest: unknown;
    created_by: string;
};

// ============================================================
// Wrappers de las RPCs custom (POST /api/custom/...)
// ============================================================

async function callCustom<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return pb.send<T>(path, {
        method: "POST",
        body,
    });
}

export const rpc = {
    createGroup: (name: string) =>
        callCustom<{ id: string; name: string; discriminator: string; full_tag: string }>(
            "/api/custom/create-group",
            { name }
        ),

    deleteGroup: (groupId: string) =>
        callCustom<{ ok: true }>("/api/custom/delete-group", { group_id: groupId }),

    createInvite: (groupId: string, opts: { uses?: number; expires_at?: string } = {}) =>
        callCustom<{ code: string; group_id: string; expires_at: string; uses_left: number }>(
            "/api/custom/create-invite",
            { group_id: groupId, ...opts }
        ),

    redeemInvite: (code: string) =>
        callCustom<{ group_id: string }>("/api/custom/redeem-invite", { code }),

    changeMemberRole: (groupId: string, userId: string, role: "admin" | "player") =>
        callCustom<{ ok: true }>("/api/custom/change-member-role", {
            group_id: groupId,
            user_id: userId,
            role,
        }),

    createWorld: (groupId: string, name: string, sourceFilename?: string) =>
        callCustom<{ id: string; group_id: string; name: string; current_version: number }>(
            "/api/custom/create-world",
            {
                group_id: groupId,
                name,
                ...(sourceFilename ? { source_filename: sourceFilename } : {}),
            }
        ),

    deleteWorld: (worldId: string) =>
        callCustom<{ ok: true }>("/api/custom/delete-world", { world_id: worldId }),

    nextWorldVersion: (worldId: string) =>
        callCustom<{ world_id: string; next_version: number; world_current_version: number }>(
            "/api/custom/next-world-version",
            { world_id: worldId }
        ),

    acquireWorldLock: (worldId: string, minutes = 15) =>
        callCustom<{
            world_id: string;
            current_holder: string;
            lock_acquired_at: string;
            lock_expires_at: string;
        }>("/api/custom/acquire-world-lock", {
            world_id: worldId,
            minutes,
        }),

    releaseWorldLock: (worldId: string) =>
        callCustom<{ ok: true }>("/api/custom/release-world-lock", { world_id: worldId }),
};
