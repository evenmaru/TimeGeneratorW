import { describe, expect, it, vi } from "vitest";
import { AppController } from "../../src/application/appController";
import { AppSession } from "../../src/application/appSession";
import type {
  AuthError,
  AuthGateway,
  AuthUser,
  Unsubscribe,
} from "../../src/application/ports/authGateway";
import type {
  AppStateLoadResult,
  AppStateRepository,
} from "../../src/application/ports/appStateRepository";
import type { AppStateWriter, StateWriteError } from "../../src/application/ports/appStateWriter";
import type {
  RemoteAppState,
  RemoteAppStateRepository,
  RemoteStateError,
} from "../../src/application/ports/remoteAppStateRepository";
import { createInitialAppState, type AppState } from "../../src/domain/models";
import { failure, success, type Result } from "../../src/domain/result";
import {
  FixedIdGenerator,
  MemoryBackupFilePort,
  RecordingClipboardPort,
  SequenceRandomSource,
  StubTimeZonePort,
  createStateFixture,
} from "../helpers/fakes";

const USER: AuthUser = {
  uid: "firebase-user",
  email: "user@example.com",
  displayName: "테스트 사용자",
  photoUrl: null,
};

class FakeAuthGateway implements AuthGateway {
  private onChange: ((user: AuthUser | null) => void) | null = null;

  public observeAuthState(
    onChange: (user: AuthUser | null) => void,
    _onError: (error: AuthError) => void,
  ): Unsubscribe {
    this.onChange = onChange;
    return () => {
      this.onChange = null;
    };
  }

  public async signInWithGoogle(): Promise<Result<AuthUser, AuthError>> {
    this.onChange?.(USER);
    return success(USER);
  }

  public async signOut(): Promise<Result<void, AuthError>> {
    this.onChange?.(null);
    return success(undefined);
  }

  public emit(user: AuthUser | null): void {
    this.onChange?.(user);
  }
}

class FakeRemoteRepository implements RemoteAppStateRepository {
  public value: RemoteAppState | null = null;
  private onChange: ((value: RemoteAppState | null) => void) | null = null;

  public async load(): Promise<Result<RemoteAppState | null, RemoteStateError>> {
    return success(this.value);
  }

  public async save(
    _userId: string,
    state: AppState,
    expectedRevision: number | null,
  ): Promise<Result<number, RemoteStateError>> {
    const currentRevision = this.value?.revision ?? null;
    if (currentRevision !== expectedRevision) {
      return failure({ code: "revision_conflict", message: "충돌" });
    }
    const revision = (expectedRevision ?? 0) + 1;
    this.value = { state, revision };
    this.onChange?.(this.value);
    return success(revision);
  }

  public subscribe(
    _userId: string,
    onChange: (value: RemoteAppState | null) => void,
    _onError: (error: RemoteStateError) => void,
  ): Unsubscribe {
    this.onChange = onChange;
    return () => {
      this.onChange = null;
    };
  }

  public emit(value: RemoteAppState): void {
    this.value = value;
    this.onChange?.(value);
  }
}

class FakeLocalRepository implements AppStateRepository {
  public savedState: AppState | null = null;

  public constructor(private readonly loadResult: AppStateLoadResult) {}

  public load(): AppStateLoadResult {
    return this.loadResult;
  }

  public async save(state: AppState): Promise<Result<void, StateWriteError>> {
    this.savedState = state;
    return success(undefined);
  }

  public preserveCurrentStateAsRecovery(): boolean {
    return true;
  }
}

function createSession(localState: AppState | null = null) {
  const auth = new FakeAuthGateway();
  const remote = new FakeRemoteRepository();
  const local = new FakeLocalRepository({
    state: localState ?? createInitialAppState(),
    notices: [],
    hasStoredState: localState !== null,
  });
  const session = new AppSession(auth, remote, local, createController);
  session.start();
  return { session, auth, remote, local };
}

function createController(state: AppState, writer: AppStateWriter): AppController {
  return new AppController(
    state,
    writer,
    new FixedIdGenerator("123e4567-e89b-42d3-a456-426614174001"),
    new SequenceRandomSource([0, 0]),
    new StubTimeZonePort(),
    new RecordingClipboardPort(),
    new MemoryBackupFilePort(),
  );
}

describe("Firebase 앱 세션 통합", () => {
  it("첫 로그인에서 원격 문서를 만들고 이후 변경을 리비전과 함께 저장한다", async () => {
    const { session, auth, remote, local } = createSession();
    auth.emit(USER);

    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe("ready"));
    expect(remote.value).toEqual({ state: createInitialAppState(), revision: 1 });

    const snapshot = session.getSnapshot();
    if (snapshot.phase !== "ready") {
      throw new Error("준비 상태가 아닙니다.");
    }
    await expect(
      snapshot.controller.createSlot({
        name: "동기화 슬롯",
        startDate: "2026-09-21",
        endDate: "2026-09-25",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(remote.value).toMatchObject({ revision: 2, state: { slots: [{ name: "동기화 슬롯" }] } });
    expect(local.savedState).toMatchObject({ slots: [{ name: "동기화 슬롯" }] });
  });

  it("원격 문서가 없고 로컬 데이터가 있으면 사용자가 이전 여부를 결정한다", async () => {
    const localState = createStateFixture();
    const { session, auth, remote } = createSession(localState);
    auth.emit(USER);

    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe("migration"));
    await session.resolveMigration(true);

    expect(session.getSnapshot().phase).toBe("ready");
    expect(remote.value).toEqual({ state: localState, revision: 1 });
  });

  it("더 높은 원격 리비전을 받으면 현재 화면 상태와 로컬 캐시를 교체한다", async () => {
    const { session, auth, remote, local } = createSession();
    remote.value = { state: createInitialAppState(), revision: 3 };
    auth.emit(USER);
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe("ready"));

    const changed = createStateFixture();
    remote.emit({ state: changed, revision: 4 });

    await vi.waitFor(() => {
      const snapshot = session.getSnapshot();
      expect(snapshot.phase).toBe("ready");
      if (snapshot.phase === "ready") {
        expect(snapshot.controller.getSnapshot().state).toEqual(changed);
      }
    });
    expect(local.savedState).toEqual(changed);
  });
});
