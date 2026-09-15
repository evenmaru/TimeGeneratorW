import type {
  AppStateLoadResult,
  AppStateRepository,
  StartupNotice,
} from "../../application/ports/appStateRepository";
import type { StateWriteError } from "../../application/ports/appStateWriter";
import { createInitialAppState, type AppState } from "../../domain/models";
import type { TimeZonePort } from "../../domain/ports/timeZonePort";
import { failure, success, type Result } from "../../domain/result";
import { validateAndNormalizeAppState } from "../../domain/validation";
import { decodeAppStateJson, encodeAppStateJson } from "../../application/appStateJsonCodec";
import type { KeyValueStorage } from "./keyValueStorage";

export const APP_STATE_STORAGE_KEY = "time-generator.app-state";
export const APP_STATE_RECOVERY_KEY = "time-generator.app-state.recovery";

export class LocalStorageAppStateRepository implements AppStateRepository {
  private writesBlocked = false;

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly timeZonePort: TimeZonePort,
  ) {}

  public load(): AppStateLoadResult {
    this.writesBlocked = false;

    let raw: string | null;
    try {
      raw = this.storage.getItem(APP_STATE_STORAGE_KEY);
    } catch (cause) {
      return {
        state: createInitialAppState(),
        notices: [
          {
            code: "storage_read_failed",
            tone: "error",
            message:
              "브라우저 저장소를 읽을 수 없어 빈 상태로 시작했습니다. 저장소 접근 설정을 확인해 주세요.",
          },
        ],
      };
    }

    if (raw === null) {
      return { state: createInitialAppState(), notices: [] };
    }

    const decodeResult = decodeAppStateJson(raw, this.timeZonePort);
    if (!decodeResult.ok && decodeResult.error.code === "unsupported_newer_schema") {
      const preserved = this.tryPreserveRecoveryCopy(raw);
      this.writesBlocked = true;
      const notices: StartupNotice[] = [
        {
          code: "unsupported_newer_schema",
          tone: "error",
          message:
            "이 앱보다 새로운 버전의 저장 데이터를 발견했습니다. 원본 보호를 위해 변경 저장을 차단했습니다.",
        },
      ];
      if (!preserved) {
        notices.push(recoveryCopyFailedNotice());
      }
      return { state: createInitialAppState(), notices };
    }

    if (!decodeResult.ok) {
      return this.recoverInvalidState(raw);
    }

    const { state, normalized } = decodeResult.value;
    if (!normalized) {
      return { state, notices: [] };
    }

    try {
      this.storage.setItem(APP_STATE_STORAGE_KEY, encodeAppStateJson(state));
      return {
        state,
        notices: [
          {
            code: "state_normalized",
            tone: "warning",
            message: "저장된 상태에서 안전하게 고칠 수 있는 값을 정리했습니다.",
          },
        ],
      };
    } catch {
      return {
        state,
        notices: [
          {
            code: "normalization_save_failed",
            tone: "error",
            message:
              "저장된 상태는 복구했지만 정리한 값을 다시 저장하지 못했습니다. 현재 탭의 상태는 사용할 수 있습니다.",
          },
        ],
      };
    }
  }

  public save(state: AppState): Result<void, StateWriteError> {
    if (this.writesBlocked) {
      return failure({
        code: "save_failed",
        message:
          "더 새로운 버전의 저장 데이터를 보호하고 있어 변경 내용을 저장할 수 없습니다.",
      });
    }

    const validationResult = validateAndNormalizeAppState(state, this.timeZonePort);
    if (!validationResult.ok || validationResult.value.normalized) {
      return failure({
        code: "save_failed",
        message: "애플리케이션 상태가 올바르지 않아 변경 내용을 저장하지 않았습니다.",
      });
    }

    let serialized: string;
    try {
      serialized = encodeAppStateJson(validationResult.value.state);
    } catch (cause) {
      return failure({
        code: "save_failed",
        message: "변경 내용을 저장할 문자열로 변환하지 못했습니다.",
        cause,
      });
    }

    try {
      this.storage.setItem(APP_STATE_STORAGE_KEY, serialized);
      return success(undefined);
    } catch (cause) {
      return failure({
        code: "save_failed",
        message:
          "브라우저 저장소에 변경 내용을 저장하지 못했습니다. 저장소 접근 설정과 남은 용량을 확인해 주세요.",
        cause,
      });
    }
  }

  private recoverInvalidState(raw: string): AppStateLoadResult {
    const preserved = this.tryPreserveRecoveryCopy(raw);
    const state = createInitialAppState();
    const notices: StartupNotice[] = [
      {
        code: "state_recovered",
        tone: "warning",
        message:
          "저장된 데이터를 안전하게 복구할 수 없어 빈 상태로 초기화했습니다. 가능한 경우 복구용 원문을 별도로 보존했습니다.",
      },
    ];

    if (!preserved) {
      notices.push(recoveryCopyFailedNotice());
    }

    try {
      this.storage.setItem(APP_STATE_STORAGE_KEY, encodeAppStateJson(state));
    } catch {
      notices.push({
        code: "normalization_save_failed",
        tone: "error",
        message:
          "빈 상태를 브라우저 저장소에 기록하지 못했습니다. 현재 탭에서는 빈 상태로 계속할 수 있습니다.",
      });
    }

    return { state, notices };
  }

  private tryPreserveRecoveryCopy(raw: string): boolean {
    try {
      this.storage.setItem(APP_STATE_RECOVERY_KEY, raw);
      return true;
    } catch {
      return false;
    }
  }
}

function recoveryCopyFailedNotice(): StartupNotice {
  return {
    code: "recovery_copy_failed",
    tone: "error",
    message: "손상된 저장 데이터의 복구용 원문도 보존하지 못했습니다.",
  };
}
