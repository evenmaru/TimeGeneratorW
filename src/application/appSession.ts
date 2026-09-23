import type { AppController } from "./appController";
import type { AuthGateway, AuthUser, Unsubscribe } from "./ports/authGateway";
import type {
  AppStateLoadResult,
  AppStateRepository,
  StartupNotice,
} from "./ports/appStateRepository";
import type { AppStateWriter } from "./ports/appStateWriter";
import type {
  RemoteAppState,
  RemoteAppStateRepository,
} from "./ports/remoteAppStateRepository";
import { SynchronizedAppStateWriter, type SyncStatus } from "./synchronizedAppStateWriter";
import { createInitialAppState, type AppState } from "../domain/models";

type SessionBase = Readonly<{
  message: string | null;
}>;

export type AppSessionSnapshot =
  | (SessionBase & Readonly<{ phase: "checking_auth" }>)
  | (SessionBase & Readonly<{ phase: "signed_out" }>)
  | (SessionBase & Readonly<{ phase: "loading"; user: AuthUser }>)
  | (SessionBase &
      Readonly<{
        phase: "migration";
        user: AuthUser;
        localState: AppState;
      }>)
  | (SessionBase & Readonly<{ phase: "error"; user: AuthUser }>)
  | (SessionBase &
      Readonly<{
        phase: "ready";
        user: AuthUser;
        controller: AppController;
        notices: readonly StartupNotice[];
        syncStatus: SyncStatus;
      }>);

type ControllerFactory = (state: AppState, writer: AppStateWriter) => AppController;

export class AppSession {
  private snapshot: AppSessionSnapshot = { phase: "checking_auth", message: null };
  private readonly listeners = new Set<() => void>();
  private readonly localLoadResult: AppStateLoadResult;
  private authRequestId = 0;
  private stopAuthObserver: Unsubscribe | null = null;
  private stopRemoteObserver: Unsubscribe | null = null;
  private writer: SynchronizedAppStateWriter | null = null;

  public constructor(
    private readonly authGateway: AuthGateway,
    private readonly remoteRepository: RemoteAppStateRepository,
    private readonly localRepository: AppStateRepository,
    private readonly createController: ControllerFactory,
  ) {
    this.localLoadResult = localRepository.load();
  }

  public start(): void {
    if (this.stopAuthObserver !== null) {
      return;
    }

    this.stopAuthObserver = this.authGateway.observeAuthState(
      (user) => {
        if (user === null) {
          this.authRequestId += 1;
          this.stopRemoteSubscription();
          this.setSnapshot({ phase: "signed_out", message: null });
          return;
        }
        void this.loadUserState(user);
      },
      (error) => {
        this.setSnapshot({ phase: "signed_out", message: error.message });
      },
    );
  }

  public getSnapshot(): AppSessionSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async signIn(): Promise<void> {
    this.setSnapshot({ phase: "checking_auth", message: null });
    const result = await this.authGateway.signInWithGoogle();
    if (!result.ok) {
      this.setSnapshot({ phase: "signed_out", message: result.error.message });
    }
  }

  public async signOut(): Promise<void> {
    const result = await this.authGateway.signOut();
    if (!result.ok) {
      const current = this.snapshot;
      if (current.phase === "ready") {
        this.setSnapshot({ ...current, message: result.error.message, syncStatus: "sync_error" });
      } else if ("user" in current) {
        this.setSnapshot({ phase: "error", user: current.user, message: result.error.message });
      } else {
        this.setSnapshot({ phase: "signed_out", message: result.error.message });
      }
    }
  }

  public async retry(): Promise<void> {
    const current = this.snapshot;
    if ("user" in current) {
      await this.loadUserState(current.user);
    }
  }

  public async resolveMigration(useLocalState: boolean): Promise<void> {
    const current = this.snapshot;
    if (current.phase !== "migration") {
      return;
    }

    const requestId = this.authRequestId;
    const state = useLocalState ? current.localState : createInitialAppState();
    if (!useLocalState) {
      this.localRepository.preserveCurrentStateAsRecovery();
    }
    this.setSnapshot({ phase: "loading", user: current.user, message: null });
    const saveResult = await this.remoteRepository.save(current.user.uid, state, null);
    if (requestId !== this.authRequestId) {
      return;
    }
    if (!saveResult.ok) {
      this.setSnapshot({ phase: "error", user: current.user, message: saveResult.error.message });
      return;
    }
    await this.enterReadyState(current.user, { state, revision: saveResult.value }, requestId);
  }

  private async loadUserState(user: AuthUser): Promise<void> {
    const requestId = ++this.authRequestId;
    this.stopRemoteSubscription();
    this.setSnapshot({ phase: "loading", user, message: null });
    const result = await this.remoteRepository.load(user.uid);
    if (requestId !== this.authRequestId) {
      return;
    }

    if (!result.ok) {
      this.setSnapshot({ phase: "error", user, message: result.error.message });
      return;
    }

    if (result.value !== null) {
      await this.enterReadyState(user, result.value, requestId);
      return;
    }

    if (hasMeaningfulLocalState(this.localLoadResult)) {
      this.setSnapshot({
        phase: "migration",
        user,
        localState: this.localLoadResult.state,
        message: null,
      });
      return;
    }

    const initialState = createInitialAppState();
    const createResult = await this.remoteRepository.save(user.uid, initialState, null);
    if (requestId !== this.authRequestId) {
      return;
    }
    if (!createResult.ok) {
      this.setSnapshot({ phase: "error", user, message: createResult.error.message });
      return;
    }
    await this.enterReadyState(
      user,
      { state: initialState, revision: createResult.value },
      requestId,
    );
  }

  private async enterReadyState(
    user: AuthUser,
    remote: RemoteAppState,
    requestId: number,
  ): Promise<void> {
    let syncStatus: SyncStatus = "synced";
    let message: string | null = null;
    const cacheResult = await this.localRepository.save(remote.state);
    if (!cacheResult.ok) {
      syncStatus = "cache_warning";
      message = "Firebase 데이터는 불러왔지만 이 브라우저의 캐시에는 저장하지 못했습니다.";
    }

    if (requestId !== this.authRequestId) {
      return;
    }

    let writer: SynchronizedAppStateWriter;
    writer = new SynchronizedAppStateWriter(
      user.uid,
      remote.revision,
      this.remoteRepository,
      this.localRepository,
      (update) => {
        const current = this.snapshot;
        if (current.phase === "ready" && this.writer === writer) {
          this.snapshot = {
            ...current,
            syncStatus: update.status,
            message: update.message,
          };
        }
      },
    );
    const controller = this.createController(remote.state, writer);
    this.writer = writer;
    this.setSnapshot({
      phase: "ready",
      user,
      controller,
      notices: this.localLoadResult.notices,
      syncStatus,
      message,
    });

    this.stopRemoteObserver = this.remoteRepository.subscribe(
      user.uid,
      (value) => void this.applyRemoteUpdate(value),
      (error) => {
        const current = this.snapshot;
        if (current.phase === "ready") {
          this.setSnapshot({
            ...current,
            syncStatus: "sync_error",
            message: error.message,
          });
        }
      },
    );
  }

  private async applyRemoteUpdate(remote: RemoteAppState | null): Promise<void> {
    const current = this.snapshot;
    const writer = this.writer;
    if (current.phase !== "ready" || writer === null) {
      return;
    }
    if (remote === null) {
      this.setSnapshot({
        ...current,
        syncStatus: "sync_error",
        message: "Firebase에서 동기화 문서를 찾을 수 없습니다. 새로고침해 다시 연결해 주세요.",
      });
      return;
    }
    const currentRevision = writer.getRevision();
    if (currentRevision !== null && remote.revision <= currentRevision) {
      return;
    }

    writer.acceptRemoteRevision(remote.revision);
    current.controller.replaceStateFromRemote(remote.state);
    const cacheResult = await this.localRepository.save(remote.state);
    const latest = this.snapshot;
    if (
      latest.phase !== "ready" ||
      latest.controller !== current.controller ||
      this.writer !== writer
    ) {
      return;
    }
    this.setSnapshot({
      ...latest,
      syncStatus: cacheResult.ok ? "synced" : "cache_warning",
      message: cacheResult.ok
        ? null
        : "다른 기기의 변경은 반영했지만 이 브라우저의 캐시에는 저장하지 못했습니다.",
    });
  }

  private stopRemoteSubscription(): void {
    this.stopRemoteObserver?.();
    this.stopRemoteObserver = null;
    this.writer = null;
  }

  private setSnapshot(snapshot: AppSessionSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

function hasMeaningfulLocalState(loadResult: AppStateLoadResult): boolean {
  return (
    loadResult.hasStoredState &&
    (loadResult.state.slots.length > 0 || loadResult.state.shellFormat !== null)
  );
}
