import type { AppStateWriter, StateWriteError } from "../../src/application/ports/appStateWriter";
import type { BackupFileError, BackupFilePort } from "../../src/application/ports/backupFilePort";
import type { ClipboardError, ClipboardPort } from "../../src/application/ports/clipboardPort";
import type { AppState } from "../../src/domain/models";
import type { IdGenerator } from "../../src/domain/ports/idGenerator";
import type { RandomSource } from "../../src/domain/ports/randomSource";
import type { TimeZonePort } from "../../src/domain/ports/timeZonePort";
import { failure, success, type Result } from "../../src/domain/result";

export class SequenceRandomSource implements RandomSource {
  private index = 0;

  public constructor(private readonly values: readonly number[]) {}

  public next(): number {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error("테스트 난수열이 소진되었습니다.");
    }
    this.index += 1;
    return value;
  }

  public get callCount(): number {
    return this.index;
  }
}

export class StubTimeZonePort implements TimeZonePort {
  public constructor(
    private readonly currentTimeZone: string | null = "UTC",
    private readonly offsets: Readonly<Record<string, readonly string[]>> = {},
  ) {}

  public getCurrentTimeZone(): string | null {
    return this.currentTimeZone;
  }

  public isValidTimeZone(timeZone: string): boolean {
    return timeZone === "UTC" || timeZone === "Asia/Seoul" || timeZone === "America/New_York";
  }

  public getValidUtcOffsets(localDateTime: string, timeZone: string): readonly string[] {
    const overridden = this.offsets[`${timeZone}:${localDateTime}`];
    if (overridden !== undefined) {
      return overridden;
    }
    if (timeZone === "UTC") {
      return ["+00:00"];
    }
    if (timeZone === "Asia/Seoul") {
      return ["+09:00"];
    }
    return ["-04:00"];
  }
}

export class FixedIdGenerator implements IdGenerator {
  public constructor(
    private readonly id = "123e4567-e89b-42d3-a456-426614174000",
  ) {}

  public createId(): string {
    return this.id;
  }
}

export class RecordingStateWriter implements AppStateWriter {
  public readonly savedStates: AppState[] = [];
  public shouldFail = false;

  public save(state: AppState): Result<void, StateWriteError> {
    if (this.shouldFail) {
      return failure({ code: "save_failed", message: "테스트 저장 실패" });
    }
    this.savedStates.push(state);
    return success(undefined);
  }
}

export class RecordingClipboardPort implements ClipboardPort {
  public values: string[] = [];
  public shouldFail = false;

  public async writeText(value: string): Promise<Result<void, ClipboardError>> {
    if (this.shouldFail) {
      return failure({ code: "clipboard_failed", message: "테스트 복사 실패" });
    }
    this.values.push(value);
    return success(undefined);
  }
}

export class MemoryBackupFilePort implements BackupFilePort {
  public readValue = "";
  public downloaded: Readonly<{ fileName: string; content: string }> | null = null;
  public readShouldFail = false;
  public downloadShouldFail = false;

  public async readText(_file: unknown): Promise<Result<string, BackupFileError>> {
    if (this.readShouldFail) {
      return failure({ code: "file_read_failed", message: "테스트 읽기 실패" });
    }
    return success(this.readValue);
  }

  public downloadText(
    fileName: string,
    content: string,
  ): Result<void, BackupFileError> {
    if (this.downloadShouldFail) {
      return failure({ code: "file_download_failed", message: "테스트 다운로드 실패" });
    }
    this.downloaded = { fileName, content };
    return success(undefined);
  }
}

export function createSlotFixture(
  overrides: Partial<AppState["slots"][number]> = {},
): AppState["slots"][number] {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    name: "테스트 슬롯",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    timeZone: "UTC",
    lastGeneratedTime: null,
    ...overrides,
  };
}

export function createStateFixture(
  overrides: Partial<AppState> = {},
): AppState {
  return {
    schemaVersion: 1,
    slots: [createSlotFixture()],
    shellFormat: null,
    ...overrides,
  };
}
