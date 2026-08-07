/// <reference path="../pb_data/types.d.ts" />

// Hooks de PocketBase para VS Server Manager.
// Cada handler es self-contained porque el JSVM de PocketBase aisla los handlers
// y no les comparte funciones top-level.

routerAdd("POST", "/api/custom/create-group", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    // Gate cloud-tier feature behind cloud_enabled flag on the user record.
    if (!auth.get("cloud_enabled")) {
        throw new ForbiddenError("Cloud features not enabled for this account. Contact the administrator.");
    }
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const name = body.name;
    if (!name || typeof name !== "string" || name.trim().length < 1) {
        throw new BadRequestError("name required");
    }
    const trimmed = name.trim();
    if (trimmed.length > 100) throw new BadRequestError("name too long");

    let out;
    $app.runInTransaction((txApp) => {
        let disc = null;
        for (let i = 0; i < 50; i++) {
            // CSPRNG (no Math.random): el discriminador es parte de full_tag.
            const candidate = $security.randomStringWithAlphabet(4, "0123456789");
            const tag = trimmed + "#" + candidate;
            let exists = false;
            try {
                txApp.findFirstRecordByFilter("groups", "full_tag = {:t}", { t: tag });
                exists = true;
            } catch (_) { /* not found is good */ }
            if (!exists) { disc = candidate; break; }
        }
        if (!disc) throw new ApiError(500, "Could not allocate discriminator");

        const groupsCol = txApp.findCollectionByNameOrId("groups");
        const g = new Record(groupsCol);
        g.set("name", trimmed);
        g.set("discriminator", disc);
        g.set("full_tag", trimmed + "#" + disc);
        g.set("owner", auth.id);
        txApp.save(g);

        const membersCol = txApp.findCollectionByNameOrId("group_members");
        const m = new Record(membersCol);
        m.set("group", g.id);
        m.set("user", auth.id);
        m.set("role", "owner");
        txApp.save(m);

        out = { id: g.id, name: g.get("name"), discriminator: disc, full_tag: g.get("full_tag") };
    });
    return c.json(200, out);
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/delete-group", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const group_id = body.group_id;
    if (!group_id) throw new BadRequestError("group_id required");

    let g;
    try { g = $app.findRecordById("groups", group_id); }
    catch (_) { throw new NotFoundError("Group not found"); }
    if (g.get("owner") !== auth.id) {
        throw new ForbiddenError("Only the owner can delete the group");
    }
    $app.delete(g);
    return c.json(200, { ok: true });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/create-invite", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const groupId = body.group_id;
    if (!groupId) throw new BadRequestError("group_id required");

    // requireGroupAdmin inline
    let role = null;
    try {
        const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: groupId, u: auth.id });
        role = m.get("role");
    } catch (_) { /* none */ }
    if (!role) throw new ForbiddenError("Not a member of this group");
    if (role !== "owner" && role !== "admin") throw new ForbiddenError("Owner or admin required");

    const uses = Number.isFinite(body.uses) && body.uses > 0 ? Math.floor(body.uses) : 1;
    const expiresAt = body.expires_at || "";

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 20; i++) {
        // CSPRNG (no Math.random): el invite code es un secreto de acceso al grupo.
        const candidate = $security.randomStringWithAlphabet(10, chars);
        let exists = false;
        try {
            $app.findFirstRecordByFilter("invites", "code = {:c}", { c: candidate });
            exists = true;
        } catch (_) { /* free */ }
        if (!exists) { code = candidate; break; }
    }
    if (!code) throw new ApiError(500, "Could not allocate invite code");

    const invitesCol = $app.findCollectionByNameOrId("invites");
    const inv = new Record(invitesCol);
    inv.set("code", code);
    inv.set("group", groupId);
    inv.set("created_by", auth.id);
    if (expiresAt) inv.set("expires_at", expiresAt);
    inv.set("uses_left", uses);
    $app.save(inv);

    return c.json(200, {
        code: inv.get("code"),
        group_id: groupId,
        expires_at: inv.get("expires_at"),
        uses_left: inv.get("uses_left"),
    });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/redeem-invite", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const code = body.code;
    if (!code || typeof code !== "string") throw new BadRequestError("code required");

    let groupId;
    $app.runInTransaction((txApp) => {
        let inv;
        try {
            inv = txApp.findFirstRecordByFilter("invites", "code = {:c}", { c: code.trim() });
        } catch (_) { throw new NotFoundError("Invalid code"); }

        const exp = inv.get("expires_at");
        if (exp) {
            const expDate = new Date(exp);
            if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
                throw new BadRequestError("Invite expired");
            }
        }
        const uses = inv.get("uses_left");
        if (uses <= 0) throw new BadRequestError("Invite exhausted");

        groupId = inv.get("group");

        // Idempotente: si ya es miembro, no duplicamos
        let existingRole = null;
        try {
            const em = txApp.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: groupId, u: auth.id });
            existingRole = em.get("role");
        } catch (_) { /* none */ }
        if (!existingRole) {
            const membersCol = txApp.findCollectionByNameOrId("group_members");
            const m = new Record(membersCol);
            m.set("group", groupId);
            m.set("user", auth.id);
            m.set("role", "player");
            txApp.save(m);
        }

        const left = uses - 1;
        if (left <= 0) {
            txApp.delete(inv);
        } else {
            inv.set("uses_left", left);
            txApp.save(inv);
        }
    });

    return c.json(200, { group_id: groupId });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/change-member-role", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const group_id = body.group_id;
    const user_id = body.user_id;
    const role = body.role;
    if (!group_id || !user_id || !role) {
        throw new BadRequestError("group_id, user_id and role required");
    }
    if (role !== "admin" && role !== "player") {
        throw new BadRequestError("role must be admin or player");
    }

    // requireGroupOwner inline
    let myRole = null;
    try {
        const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: group_id, u: auth.id });
        myRole = m.get("role");
    } catch (_) { /* none */ }
    if (myRole !== "owner") throw new ForbiddenError("Only the owner can do this");

    let target;
    try {
        target = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: group_id, u: user_id });
    } catch (_) { throw new NotFoundError("Member not found"); }
    if (target.get("role") === "owner") {
        throw new BadRequestError("Cannot change owner role");
    }
    target.set("role", role);
    $app.save(target);
    return c.json(200, { ok: true });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/create-world", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    // Gate cloud-tier feature behind cloud_enabled flag on the user record.
    if (!auth.get("cloud_enabled")) {
        throw new ForbiddenError("Cloud features not enabled for this account. Contact the administrator.");
    }
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const groupId = body.group_id;
    const name = body.name;
    if (!groupId || !name || typeof name !== "string" || !name.trim()) {
        throw new BadRequestError("group_id and name required");
    }

    // requireMember inline
    let role = null;
    try {
        const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: groupId, u: auth.id });
        role = m.get("role");
    } catch (_) { /* none */ }
    if (!role) throw new ForbiddenError("Not a member of this group");

    const worldsCol = $app.findCollectionByNameOrId("worlds");
    const w = new Record(worldsCol);
    w.set("group", groupId);
    w.set("name", name.trim());
    w.set("current_version", 0);
    if (body.source_filename) w.set("source_filename", String(body.source_filename));
    $app.save(w);

    return c.json(200, {
        id: w.id,
        group_id: groupId,
        name: w.get("name"),
        current_version: 0,
    });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/delete-world", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const world_id = body.world_id;
    if (!world_id) throw new BadRequestError("world_id required");

    let w;
    try { w = $app.findRecordById("worlds", world_id); }
    catch (_) { throw new NotFoundError("World not found"); }

    // requireGroupAdmin inline
    let role = null;
    try {
        const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: w.get("group"), u: auth.id });
        role = m.get("role");
    } catch (_) { /* none */ }
    if (!role) throw new ForbiddenError("Not a member of this group");
    if (role !== "owner" && role !== "admin") throw new ForbiddenError("Owner or admin required");

    $app.delete(w);
    return c.json(200, { ok: true });
}, $apis.requireAuth());

// Calcula el siguiente numero de version SEGURO contra colision con el indice
// unico (world, version) de world_versions. Antes leiamos world.current_version
// y sumabamos 1, pero ese campo lo bumpea onRecordAfterCreateSuccess y puede
// quedar desfasado si ese hook fallo (busy timeout SQLite, deploy desactualizado,
// etc): el client recalcula nextVersion = stale + 1, colisiona, y PocketBase
// devuelve 400 "Failed to create record" con data: {} (los unique compuestos
// caen al nivel SQL, no se reportan por campo). Ahora computamos directo del
// MAX real de world_versions dentro de una transaccion. El world lock asegura
// que hay un solo holder uploadeando a la vez, asi que el race despues del
// MAX es practicamente cero.
routerAdd("POST", "/api/custom/next-world-version", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const world_id = body.world_id;
    if (!world_id) throw new BadRequestError("world_id required");

    let nextVersion;
    let currentVersionField;
    $app.runInTransaction((txApp) => {
        let w;
        try { w = txApp.findRecordById("worlds", world_id); }
        catch (_) { throw new NotFoundError("World not found"); }

        // requireMember inline
        let role = null;
        try {
            const m = txApp.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: w.get("group"), u: auth.id });
            role = m.get("role");
        } catch (_) { /* none */ }
        if (!role) throw new ForbiddenError("Not a member of this group");

        // MAX(version) real del mundo. findRecordsByFilter sort "-version" trae
        // primero la version mas alta; pedimos 1 y listo. Si no hay versiones,
        // el array sale vacio y arrancamos en 1.
        let maxVersion = 0;
        const versions = txApp.findRecordsByFilter(
            "world_versions",
            "world = {:w}",
            "-version",
            1,
            0,
            { w: world_id }
        );
        if (versions.length > 0) {
            maxVersion = versions[0].get("version") || 0;
        }
        nextVersion = maxVersion + 1;
        currentVersionField = w.get("current_version") || 0;
    });

    return c.json(200, {
        world_id: world_id,
        next_version: nextVersion,
        // Devolvemos tambien current_version para que el client pueda detectar
        // drift y/o forzar un sync defensivo si quiere.
        world_current_version: currentVersionField,
    });
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/acquire-world-lock", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    // Gate cloud-tier feature behind cloud_enabled flag on the user record.
    // Only paid/enabled users can host (locking the world is the host action).
    if (!auth.get("cloud_enabled")) {
        throw new ForbiddenError("Cloud features not enabled for this account. Contact the administrator.");
    }
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const worldId = body.world_id;
    if (!worldId) throw new BadRequestError("world_id required");
    // Cap a 120 min: el cliente refresca con heartbeat cada pocos minutos, asi
    // que 2h es de sobra para una sesion normal. Sin cap, un miembro malicioso
    // podria pedir un lock de Number.MAX_SAFE_INTEGER y bloquear el mundo.
    const requested = Number.isFinite(body.minutes) && body.minutes > 0 ? Math.floor(body.minutes) : 30;
    const minutes = Math.min(requested, 120);

    let result;
    $app.runInTransaction((txApp) => {
        let w;
        try { w = txApp.findRecordById("worlds", worldId); }
        catch (_) { throw new NotFoundError("World not found"); }

        // requireMember inline
        let role = null;
        try {
            const m = txApp.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: w.get("group"), u: auth.id });
            role = m.get("role");
        } catch (_) { /* none */ }
        if (!role) throw new ForbiddenError("Not a member of this group");

        const now = new Date();
        const exp = w.get("lock_expires_at");
        const holder = w.get("current_holder");
        const expired = !exp || new Date(exp).getTime() < now.getTime();
        if (holder && holder !== auth.id && !expired) {
            throw new ApiError(409, "World is locked by another user");
        }

        const newExp = new Date(now.getTime() + minutes * 60 * 1000);
        w.set("current_holder", auth.id);
        w.set("lock_acquired_at", now.toISOString().replace("T", " ").replace("Z", ""));
        w.set("lock_expires_at", newExp.toISOString().replace("T", " ").replace("Z", ""));
        txApp.save(w);

        result = {
            world_id: worldId,
            current_holder: auth.id,
            lock_acquired_at: w.get("lock_acquired_at"),
            lock_expires_at: w.get("lock_expires_at"),
        };
    });

    return c.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/custom/release-world-lock", (c) => {
    const auth = c.auth;
    if (!auth) throw new UnauthorizedError();
    const info = c.requestInfo();
    const body = (info && info.body) ? info.body : {};
    const world_id = body.world_id;
    if (!world_id) throw new BadRequestError("world_id required");

    let w;
    try { w = $app.findRecordById("worlds", world_id); }
    catch (_) { throw new NotFoundError("World not found"); }

    const holder = w.get("current_holder");
    if (holder !== auth.id) {
        // Si no soy holder, exigir admin/owner del grupo
        let role = null;
        try {
            const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: w.get("group"), u: auth.id });
            role = m.get("role");
        } catch (_) { /* none */ }
        if (role !== "owner" && role !== "admin") {
            throw new ForbiddenError("Not the lock holder");
        }
    }

    w.set("current_holder", null);
    w.set("lock_acquired_at", null);
    w.set("lock_expires_at", null);
    $app.save(w);
    return c.json(200, { ok: true });
}, $apis.requireAuth());

// Hook BEFORE create world_version: gate por cloud_enabled + cap de tamaño.
// El cap del field (5GB) es el techo absoluto; este hook aplica el cap real
// per-user (default 2GB, override via users.max_upload_bytes).
//
// CRITICO usar onRecordCreateRequest, NO onRecordCreate. La diferencia:
//  - onRecordCreate(e: RecordEvent)        → SIN requestInfo() / auth context
//  - onRecordCreateRequest(e: RecordRequestEvent) → CON requestInfo() / auth
// Con onRecordCreate llamar e.requestInfo() tira
// `TypeError: Object has no member 'requestInfo'` y PocketBase devuelve
// "Failed to create record" con data:{} — el JSVM error queda oculto detras de
// un 400 generico. Sintoma: TODOS los uploads de save fallan al hacer Stop,
// el progreso de la sesion se pierde, current_version no avanza, y al
// re-abrir el server descargas la version vieja.
//
// Nota: size_bytes lo envia el cliente. Un cliente malicioso podria mentir,
// pero el field maxSize del archivo ya rechaza uploads >5GB antes de que el
// hook se dispare, asi que el blast radius esta acotado.
onRecordCreateRequest((e) => {
    const info = e.requestInfo();
    const auth = info && info.auth;
    if (!auth) {
        throw new UnauthorizedError("Authentication required");
    }
    if (!auth.get("cloud_enabled")) {
        throw new ForbiddenError("Cloud features not enabled for this account. Contact the administrator.");
    }
    const sizeClaimed = Number(e.record.get("size_bytes") || 0);
    let cap = Number(auth.get("max_upload_bytes") || 0);
    if (cap <= 0) cap = 2147483648; // default 2GB
    if (sizeClaimed > cap) {
        throw new BadRequestError("Upload exceeds size cap: " + sizeClaimed + " > " + cap + " bytes");
    }

    // M5: exigir que el uploader sea el holder actual del lock del mundo. El
    // flujo legitimo (server-stop.ts en el Stop, y el seed inicial en
    // GroupDetail) toma el lock antes de subir y lo libera despues, asi que el
    // holder siempre matchea. Un miembro sin lock (no esta hosteando) ya no
    // puede inyectar/corromper versiones saltandose el sistema de locks.
    // No exigimos lock no-expirado a proposito: si el heartbeat fallo pero
    // nadie mas tomo el lock, current_holder sigue siendo este user y puede
    // subir su progreso (evita perdida de datos). Si otro tomo el lock,
    // current_holder ya es el otro y este upload se rechaza.
    const wvWorldId = e.record.get("world");
    let wvWorld;
    try { wvWorld = $app.findRecordById("worlds", wvWorldId); }
    catch (_) { throw new BadRequestError("World not found for version upload"); }
    if (wvWorld.get("current_holder") !== auth.id) {
        throw new ForbiddenError("You must hold the world lock to upload a version");
    }

    e.next();
}, "world_versions");

// Hook AFTER create world_version: (1) actualizar current_version del world,
// (2) podar versiones viejas para mantener solo las KEEP_VERSIONS mas recientes
// por mundo.
//
// Pruning policy: keep top N por version desc. La current_version siempre queda
// preservada porque es la mas alta. Las viejas (snapshots de rollback) se
// borran. Al borrar el record, PocketBase tambien remueve el archivo asociado
// del bucket, asi que se libera disco.
const KEEP_VERSIONS = 5;

onRecordAfterCreateSuccess((e) => {
    const v = e.record;
    const worldId = v.get("world");
    const version = v.get("version");

    // (1) Update current_version
    try {
        const w = e.app.findRecordById("worlds", worldId);
        if (version > (w.get("current_version") || 0)) {
            w.set("current_version", version);
            e.app.save(w);
        }
    } catch (err) {
        console.log("Failed to update world.current_version: " + err);
    }

    // (2) Prune old versions
    try {
        const all = e.app.findRecordsByFilter(
            "world_versions",
            "world = {:w}",
            "-version",
            500,
            0,
            { w: worldId }
        );
        if (all.length > KEEP_VERSIONS) {
            for (let i = KEEP_VERSIONS; i < all.length; i++) {
                try {
                    e.app.delete(all[i]);
                } catch (perr) {
                    console.log("Failed to prune world_version " + all[i].id + ": " + perr);
                }
            }
        }
    } catch (err) {
        console.log("Failed to enumerate versions for prune: " + err);
    }

    e.next();
}, "world_versions");

// ===== SEGURIDAD (C1): campos premium de users solo editables por admin =====
// users.updateRule = "id = @request.auth.id" deja que el user edite su propio
// record, pero PocketBase NO restringe QUE campos toca. Sin estos hooks,
// cualquier user autenticado podia:
//   PATCH /api/collections/users/records/<mi_id>
//   { "cloud_enabled": true, "max_upload_bytes": 999999999999 }
// y saltarse el paywall entero — todos los gates de cloud_enabled del hook
// quedan anulados si el flag lo controla el cliente. Y createRule = "" (signup
// abierto) permitia nacer directamente con cloud_enabled:true. Estos dos hooks
// cierran ambos vectores.
//
// Deteccion de superuser: el admin (via UI, collection _superusers) pasa sin
// restriccion; un user comun (auth en la collection "users") queda bloqueado.
// isSuper defaults a false → fail-closed del lado seguridad.

onRecordCreateRequest((e) => {
    let isSuper = false;
    try { if (typeof e.hasSuperuserAuth === "function" && e.hasSuperuserAuth()) isSuper = true; } catch (_) {}
    if (!isSuper) {
        try {
            const info = e.requestInfo();
            const a = info && info.auth;
            if (a && typeof a.collection === "function" && a.collection() && a.collection().name === "_superusers") isSuper = true;
        } catch (_) {}
    }
    // Signup publico (sin auth) o cualquier no-superuser: forzar defaults
    // seguros, ignorando lo que mande el cliente en el body.
    if (!isSuper) {
        e.record.set("cloud_enabled", false);
        e.record.set("max_upload_bytes", 0);
    }
    e.next();
}, "users");

onRecordUpdateRequest((e) => {
    let isSuper = false;
    try { if (typeof e.hasSuperuserAuth === "function" && e.hasSuperuserAuth()) isSuper = true; } catch (_) {}
    if (!isSuper) {
        try {
            const info = e.requestInfo();
            const a = info && info.auth;
            if (a && typeof a.collection === "function" && a.collection() && a.collection().name === "_superusers") isSuper = true;
        } catch (_) {}
    }
    if (!isSuper) {
        // Valores previos (pre-commit). original() es lo idiomatico; si no esta
        // disponible releemos de la DB — el Request hook corre antes de
        // persistir, asi que findRecordById trae los valores viejos.
        let prevCloud, prevCap;
        try {
            const orig = e.record.original();
            prevCloud = orig.get("cloud_enabled");
            prevCap = orig.get("max_upload_bytes");
        } catch (_) {
            try {
                const stored = $app.findRecordById("users", e.record.id);
                prevCloud = stored.get("cloud_enabled");
                prevCap = stored.get("max_upload_bytes");
            } catch (_2) {
                throw new ForbiddenError("Cannot verify field permissions");
            }
        }
        if (String(e.record.get("cloud_enabled")) !== String(prevCloud)) {
            throw new ForbiddenError("cloud_enabled can only be changed by an administrator");
        }
        if (String(e.record.get("max_upload_bytes")) !== String(prevCap)) {
            throw new ForbiddenError("max_upload_bytes can only be changed by an administrator");
        }
    }
    e.next();
}, "users");
