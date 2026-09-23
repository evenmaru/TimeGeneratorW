import type { AppState } from "../domain/models";
import { failure, success, type Result } from "../domain/result";
import type { AppStateRepository } from "./ports/appStateRepository";
import type { AppStateWriter, StateWriteError } from "./ports/appStateWriter";
import type { RemoteAppStateRepository } from "./ports/remoteAppStateRepository";

export type SyncStatus = "synced" | "saving" | "cache_warning" | "sync_error";

export type SyncStatusUpdate = Readonly<{
  status: SyncStatus;
  message: string | null;
}>;

export class SynchronizedAppStateWriter implements AppStateWriter {
  public constructor(
    private readonly userId: string,
    private revision: number | null,
    private readonly remoteRepository: RemoteAppStateRepository,
    private readonly localRepository: AppStateRepository,
    private readonly onStatusChange: (update: SyncStatusUpdate) => void,
  ) {}

  public getRevision(): number | null {
    return this.revision;
  }

  public acceptRemoteRevision(revision: number): void {
    if (this.revision === null || revision > this.revision) {
      this.revision = revision;
    }
  }

  public async save(state: AppState): Promise<Result<void, StateWriteError>> {
    this.onStatusChange({ status: "saving", message: null });
    const remoteResult = await this.remoteRepository.save(
      this.userId,
      state,
      this.revision,
    );

    if (!remoteResult.ok) {
      const conflict = remoteResult.error.code === "revision_conflict";
      const error: StateWriteError = {
        code: conflict ? "revision_conflict" : "save_failed",
        message: conflict
          ? "다른 기기에서 먼저 변경되었습니다. 최신 데이터를 반영했으니 다시 시도해 주세요."
          : remoteResult.error.message,
        cause: remoteResult.error.cause,
      };
      this.onStatusChange({ status: "sync_error", message: error.message });
      return failure(error);
    }

    this.revision = remoteResult.value;
    const cacheResult = await this.localRepository.save(state);
    if (!cacheResult.ok) {
      this.onStatusChange({
        status: "cache_warning",
        message:
          "Firebase에는 저장했지만 이 브라우저의 캐시에는 저장하지 못했습니다.",
      });
      return success(undefined);
    }

    this.onStatusChange({ status: "synced", message: null });
    return success(undefined);
  }
}
