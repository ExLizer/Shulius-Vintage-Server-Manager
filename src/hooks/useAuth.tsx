import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { pb, userToProfile, type Profile, type UserRecord } from "@/lib/pocketbase";

// "session" en PocketBase es el record del user autenticado. Mantenemos el nombre
// para minimizar churn en los componentes; el shape ya no es el de Supabase.
export type PbSession = UserRecord | null;

interface AuthContextValue {
    session: PbSession;
    profile: Profile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, displayName: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function recordOrNull(): UserRecord | null {
    const r = pb.authStore.record;
    if (!r) return null;
    return r as UserRecord;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<PbSession>(recordOrNull());
    const [profile, setProfile] = useState<Profile | null>(userToProfile(recordOrNull()));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                // Si hay sesion persistida, refrescamos para validar el token
                if (pb.authStore.isValid) {
                    try {
                        await pb.collection("users").authRefresh();
                    } catch (err) {
                        console.warn("authRefresh failed, clearing session:", err);
                        pb.authStore.clear();
                    }
                }
                if (!mounted) return;
                const r = recordOrNull();
                setSession(r);
                setProfile(userToProfile(r));
            } catch (err) {
                console.error("AuthProvider init failed:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        };
        init();

        // Fallback de seguridad: si init() nunca termina, no colgamos la UI
        const fallback = setTimeout(() => {
            if (mounted) setLoading(false);
        }, 5000);

        const unsubscribe = pb.authStore.onChange(() => {
            const r = recordOrNull();
            setSession(r);
            setProfile(userToProfile(r));
        });

        return () => {
            mounted = false;
            clearTimeout(fallback);
            unsubscribe();
        };
    }, []);

    const signIn = async (email: string, password: string) => {
        await pb.collection("users").authWithPassword(email, password);
    };

    const signUp = async (email: string, password: string, displayName: string) => {
        await pb.collection("users").create({
            email,
            password,
            passwordConfirm: password,
            name: displayName,
            emailVisibility: false,
        });
        await pb.collection("users").authWithPassword(email, password);
    };

    const signOut = async () => {
        // PocketBase signout es 100% local (limpia el authStore en localStorage)
        pb.authStore.clear();
        setSession(null);
        setProfile(null);
    };

    const refreshProfile = async () => {
        if (!pb.authStore.isValid) return;
        try {
            await pb.collection("users").authRefresh();
            const r = recordOrNull();
            setSession(r);
            setProfile(userToProfile(r));
        } catch (err) {
            console.error("refreshProfile failed:", err);
        }
    };

    return (
        <AuthContext.Provider
            value={{ session, profile, loading, signIn, signUp, signOut, refreshProfile }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
