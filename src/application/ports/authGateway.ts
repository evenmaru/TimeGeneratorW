import type { Result } from "../../domain/result";

export type AuthUser = Readonly<{
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
}>;

export type AuthError = Readonly<{
  code: "auth_failed";
  message: string;
  cause?: unknown;
}>;

export type Unsubscribe = () => void;

export interface AuthGateway {
  observeAuthState(
    onChange: (user: AuthUser | null) => void,
    onError: (error: AuthError) => void,
  ): Unsubscribe;
  signInWithGoogle(): Promise<Result<AuthUser, AuthError>>;
  signOut(): Promise<Result<void, AuthError>>;
}
