import { getPbUrl } from "./pocketbase";

// Flag de primer inicio: cuando el wizard se completó (o el usuario eligió
// modo local) no se vuelve a mostrar automáticamente. Siempre queda accesible
// desde Ajustes → Servidor de nube.
const SETUP_DONE_KEY = "vsm.setup_done";

export function isFirstRunSetupPending(): boolean {
    try {
        return !localStorage.getItem(SETUP_DONE_KEY) && !getPbUrl();
    } catch {
        return false;
    }
}

export function markSetupDone(): void {
    try {
        localStorage.setItem(SETUP_DONE_KEY, "1");
    } catch {
        // ignore
    }
}
