import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import type {
  AuthError,
  AuthGateway,
  AuthUser,
  Unsubscribe,
} from "../../application/ports/authGateway";
import { failure, success, type Result } from "../../domain/result";
import { firebaseApp } from "./firebaseApp";

export class FirebaseAuthGateway implements AuthGateway {
  private readonly auth = getAuth(firebaseApp);
  private readonly provider = new GoogleAuthProvider();

  public observeAuthState(
    onChange: (user: AuthUser | null) => void,
    onError: (error: AuthError) => void,
  ): Unsubscribe {
    return onAuthStateChanged(
      this.auth,
      (user) => onChange(user === null ? null : toAuthUser(user)),
      (cause) => onError(toAuthError(cause)),
    );
  }

  public async signInWithGoogle(): Promise<Result<AuthUser, AuthError>> {
    try {
      const credential = await signInWithPopup(this.auth, this.provider);
      return success(toAuthUser(credential.user));
    } catch (cause) {
      return failure(toAuthError(cause));
    }
  }

  public async signOut(): Promise<Result<void, AuthError>> {
    try {
      await signOut(this.auth);
      return success(undefined);
    } catch (cause) {
      return failure(toAuthError(cause));
    }
  }
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoURL,
  };
}

function toAuthError(cause: unknown): AuthError {
  const code = readErrorCode(cause);
  let message = "Google 로그인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  if (code === "auth/popup-closed-by-user") {
    message = "로그인 창이 닫혔습니다. 다시 로그인해 주세요.";
  } else if (code === "auth/popup-blocked") {
    message = "브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.";
  } else if (code === "auth/unauthorized-domain") {
    message = "현재 주소가 Firebase 승인 도메인에 등록되어 있지 않습니다.";
  }
  return { code: "auth_failed", message, cause };
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}
