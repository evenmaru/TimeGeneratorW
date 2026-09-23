export class GoogleAuthProvider {}

export function initializeApp(): object {
  return {};
}

export function getAuth(): object {
  return {};
}

export function getFirestore(): object {
  return {};
}

export function onAuthStateChanged(): () => void {
  return () => undefined;
}

export async function signInWithPopup(): Promise<never> {
  throw new Error("E2E 로컬 세션에서는 Firebase 로그인을 사용하지 않습니다.");
}

export async function signOut(): Promise<void> {}

export function doc(): object {
  return {};
}

export async function getDoc(): Promise<never> {
  throw new Error("E2E 로컬 세션에서는 Firestore를 사용하지 않습니다.");
}

export function onSnapshot(): () => void {
  return () => undefined;
}

export async function runTransaction(): Promise<never> {
  throw new Error("E2E 로컬 세션에서는 Firestore를 사용하지 않습니다.");
}

export function serverTimestamp(): object {
  return {};
}
