// ============================================================
// Verificaciones de setup del servidor PocketBase.
//
// Se usan en el wizard de primer inicio y en Settings para validar que
// una URL apunta a una instancia de PocketBase correctamente preparada
// para esta app (schema importado + pb_hooks instalados).
// ============================================================

import { normalizePbUrl } from "./pocketbase";

export type SetupCheckId = "reachable" | "schema" | "hooks";

export type SetupCheckStatus = "pending" | "running" | "ok" | "fail";

export interface SetupCheckResult {
    id: SetupCheckId;
    status: SetupCheckStatus;
    /** Clave i18n con el detalle del error (setup.checks.errors.*), si falló. */
    errorKey?: string;
    /** Detalle técnico crudo (status HTTP, mensaje de excepción) para mostrar colapsado. */
    detail?: string;
}

export interface SetupChecksOutcome {
    url: string;
    ok: boolean;
    results: SetupCheckResult[];
}

const CHECK_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function describeNetworkError(e: unknown): string {
    if (e instanceof DOMException && e.name === "AbortError") {
        return `timeout after ${CHECK_TIMEOUT_MS}ms`;
    }
    return e instanceof Error ? e.message : String(e);
}

/**
 * Corre las 3 verificaciones en orden, notificando progreso check por check.
 * Si una falla, las siguientes no se ejecutan (quedan en "pending").
 *
 * 1. reachable — GET /api/health responde y parece PocketBase.
 * 2. schema    — la colección `groups` existe (las migraciones corrieron).
 * 3. hooks     — las rutas /api/custom/* existen (pb_hooks instalado).
 */
export async function runSetupChecks(
    rawUrl: string,
    onProgress?: (results: SetupCheckResult[]) => void
): Promise<SetupChecksOutcome> {
    const results: SetupCheckResult[] = [
        { id: "reachable", status: "pending" },
        { id: "schema", status: "pending" },
        { id: "hooks", status: "pending" },
    ];
    const emit = () => onProgress?.(results.map((r) => ({ ...r })));

    let url: string;
    try {
        url = normalizePbUrl(rawUrl);
    } catch {
        results[0] = { id: "reachable", status: "fail", errorKey: "invalidUrl" };
        emit();
        return { url: rawUrl, ok: false, results };
    }

    // --- Check 1: el servidor responde y es PocketBase -------------------
    results[0].status = "running";
    emit();
    try {
        const res = await fetchWithTimeout(`${url}/api/health`);
        if (!res.ok) {
            results[0] = {
                id: "reachable",
                status: "fail",
                errorKey: "notPocketbase",
                detail: `GET /api/health → HTTP ${res.status}`,
            };
            emit();
            return { url, ok: false, results };
        }
        const body = (await res.json().catch(() => null)) as { code?: number } | null;
        if (!body || body.code !== 200) {
            results[0] = {
                id: "reachable",
                status: "fail",
                errorKey: "notPocketbase",
                detail: "GET /api/health returned an unexpected body",
            };
            emit();
            return { url, ok: false, results };
        }
        results[0].status = "ok";
        emit();
    } catch (e) {
        results[0] = {
            id: "reachable",
            status: "fail",
            errorKey: "unreachable",
            detail: describeNetworkError(e),
        };
        emit();
        return { url, ok: false, results };
    }

    // --- Check 2: el schema de la app está importado ---------------------
    // `groups` es una colección propia de la app: en una instancia fresca sin
    // migraciones no existe (404). Cualquier otra respuesta (200/400/401/403)
    // significa que la colección existe; no necesitamos autenticarnos.
    results[1].status = "running";
    emit();
    try {
        const res = await fetchWithTimeout(`${url}/api/collections/groups/records?perPage=1`);
        if (res.status === 404) {
            results[1] = {
                id: "schema",
                status: "fail",
                errorKey: "schemaMissing",
                detail: "collection `groups` not found (404)",
            };
            emit();
            return { url, ok: false, results };
        }
        results[1].status = "ok";
        emit();
    } catch (e) {
        results[1] = {
            id: "schema",
            status: "fail",
            errorKey: "unreachable",
            detail: describeNetworkError(e),
        };
        emit();
        return { url, ok: false, results };
    }

    // --- Check 3: pb_hooks instalado -------------------------------------
    // redeem-invite sin token responde 400/401 si el hook existe;
    // una instancia sin pb_hooks devuelve 404.
    results[2].status = "running";
    emit();
    try {
        const res = await fetchWithTimeout(`${url}/api/custom/redeem-invite`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        if (res.status === 404) {
            results[2] = {
                id: "hooks",
                status: "fail",
                errorKey: "hooksMissing",
                detail: "POST /api/custom/redeem-invite → 404",
            };
            emit();
            return { url, ok: false, results };
        }
        results[2].status = "ok";
        emit();
    } catch (e) {
        results[2] = {
            id: "hooks",
            status: "fail",
            errorKey: "unreachable",
            detail: describeNetworkError(e),
        };
        emit();
        return { url, ok: false, results };
    }

    return { url, ok: true, results };
}
