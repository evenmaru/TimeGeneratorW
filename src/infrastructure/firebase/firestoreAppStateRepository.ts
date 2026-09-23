import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { decodeAppStateJson } from "../../application/appStateJsonCodec";
import type {
  RemoteAppState,
  RemoteAppStateRepository,
  RemoteStateError,
} from "../../application/ports/remoteAppStateRepository";
import type { Unsubscribe } from "../../application/ports/authGateway";
import type { AppState } from "../../domain/models";
import type { TimeZonePort } from "../../domain/ports/timeZonePort";
import { failure, success, type Result } from "../../domain/result";
import { firebaseApp } from "./firebaseApp";

class RevisionConflictError extends Error {}

export class FirestoreAppStateRepository implements RemoteAppStateRepository {
  private readonly database = getFirestore(firebaseApp);

  public constructor(private readonly timeZonePort: TimeZonePort) {}

  public async load(
    userId: string,
  ): Promise<Result<RemoteAppState | null, RemoteStateError>> {
    try {
      const snapshot = await getDoc(this.getDocument(userId));
      if (!snapshot.exists()) {
        return success(null);
      }
      return this.decodeSnapshot(snapshot);
    } catch (cause) {
      return failure({
        code: "load_failed",
        message: toFirestoreMessage(cause, "Firebase 데이터를 불러오지 못했습니다."),
        cause,
      });
    }
  }

  public async save(
    userId: string,
    state: AppState,
    expectedRevision: number | null,
  ): Promise<Result<number, RemoteStateError>> {
    try {
      const nextRevision = await runTransaction(this.database, async (transaction) => {
        const reference = this.getDocument(userId);
        const snapshot = await transaction.get(reference);
        if (expectedRevision === null) {
          if (snapshot.exists()) {
            throw new RevisionConflictError();
          }
        } else {
          const storedRevision = snapshot.exists() ? snapshot.data()?.revision ?? null : null;
          if (storedRevision !== expectedRevision) {
            throw new RevisionConflictError();
          }
        }

        const revision = (expectedRevision ?? 0) + 1;
        transaction.set(reference, {
          state: toFirestoreValue(state),
          revision,
          updatedAt: serverTimestamp(),
        });
        return revision;
      });
      return success(nextRevision);
    } catch (cause) {
      if (cause instanceof RevisionConflictError) {
        return failure({
          code: "revision_conflict",
          message: "다른 기기에서 먼저 데이터를 변경했습니다.",
          cause,
        });
      }
      return failure({
        code: "save_failed",
        message: toFirestoreMessage(cause, "Firebase에 변경 내용을 저장하지 못했습니다."),
        cause,
      });
    }
  }

  public subscribe(
    userId: string,
    onChange: (value: RemoteAppState | null) => void,
    onError: (error: RemoteStateError) => void,
  ): Unsubscribe {
    return onSnapshot(
      this.getDocument(userId),
      (snapshot) => {
        if (!snapshot.exists()) {
          onChange(null);
          return;
        }
        const result = this.decodeSnapshot(snapshot);
        if (result.ok) {
          onChange(result.value);
        } else {
          onError({ ...result.error, code: "subscription_failed" });
        }
      },
      (cause) => {
        onError({
          code: "subscription_failed",
          message: toFirestoreMessage(cause, "Firebase 실시간 동기화 연결이 끊겼습니다."),
          cause,
        });
      },
    );
  }

  private getDocument(userId: string) {
    return doc(this.database, "appStates", userId);
  }

  private decodeSnapshot(
    snapshot: DocumentSnapshot<DocumentData>,
  ): Result<RemoteAppState, RemoteStateError> {
    const data = snapshot.data();
    const revision = data?.revision;
    if (
      data === undefined ||
      typeof revision !== "number" ||
      !Number.isInteger(revision) ||
      revision < 1
    ) {
      return failure({
        code: "invalid_remote_state",
        message: "Firebase 데이터의 버전 정보가 올바르지 않습니다.",
      });
    }

    let raw: string;
    try {
      raw = JSON.stringify(data.state);
    } catch (cause) {
      return failure({
        code: "invalid_remote_state",
        message: "Firebase 데이터를 읽을 수 있는 형식으로 변환하지 못했습니다.",
        cause,
      });
    }
    const decodeResult = decodeAppStateJson(raw, this.timeZonePort);
    if (!decodeResult.ok) {
      return failure({
        code: "invalid_remote_state",
        message: "Firebase에 저장된 앱 데이터가 올바르지 않습니다.",
        cause: decodeResult.error,
      });
    }
    return success({ state: decodeResult.value.state, revision });
  }
}

function toFirestoreValue(state: AppState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

function toFirestoreMessage(cause: unknown, fallback: string): string {
  const code = readErrorCode(cause);
  if (code === "permission-denied") {
    return "Firebase 보안 규칙이 이 계정의 접근을 허용하지 않습니다. 등록한 UID를 확인해 주세요.";
  }
  if (code === "unavailable") {
    return "Firebase에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
  }
  return fallback;
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}
