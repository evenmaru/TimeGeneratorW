import {
  CURRENT_SCHEMA_VERSION,
  type AppState,
} from "../domain/models";
import type { TimeZonePort } from "../domain/ports/timeZonePort";
import { failure, success, type Result } from "../domain/result";
import { isPlainRecord, validateAndNormalizeAppState } from "../domain/validation";

export type AppStateJsonDecodeError = Readonly<{
  code:
    | "invalid_json"
    | "invalid_state"
    | "unsupported_older_schema"
    | "unsupported_newer_schema";
  message: string;
}>;

export type DecodedAppState = Readonly<{
  state: AppState;
  normalized: boolean;
}>;

type MigrationResult = Result<
  Readonly<{ value: unknown; migrated: boolean }>,
  AppStateJsonDecodeError
>;
type Migration = (input: unknown) => Result<unknown, AppStateJsonDecodeError>;

const MIGRATIONS = new Map<number, Migration>();

export function decodeAppStateJson(
  raw: string,
  timeZonePort: TimeZonePort,
): Result<DecodedAppState, AppStateJsonDecodeError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return failure({
      code: "invalid_json",
      message: "JSON 파일 또는 저장 데이터의 형식이 올바르지 않습니다.",
    });
  }

  if (
    isPlainRecord(parsed) &&
    typeof parsed.schemaVersion === "number" &&
    Number.isInteger(parsed.schemaVersion) &&
    parsed.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    return failure({
      code: "unsupported_newer_schema",
      message: "이 앱보다 새로운 스키마 버전은 가져올 수 없습니다.",
    });
  }

  const migrationResult = migrateToCurrentSchema(parsed);
  if (!migrationResult.ok) {
    return migrationResult;
  }

  const validationResult = validateAndNormalizeAppState(
    migrationResult.value.value,
    timeZonePort,
  );
  if (!validationResult.ok) {
    return failure({
      code: "invalid_state",
      message: "필수 값이나 데이터 관계가 올바르지 않아 상태를 사용할 수 없습니다.",
    });
  }

  return success({
    state: validationResult.value.state,
    normalized: migrationResult.value.migrated || validationResult.value.normalized,
  });
}

export function encodeAppStateJson(state: AppState, pretty = false): string {
  return JSON.stringify(state, null, pretty ? 2 : undefined);
}

function migrateToCurrentSchema(input: unknown): MigrationResult {
  if (!isPlainRecord(input)) {
    return failure({
      code: "invalid_state",
      message: "상태 루트가 객체가 아닙니다.",
    });
  }

  const version = input.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return failure({
      code: "invalid_state",
      message: "스키마 버전을 확인할 수 없습니다.",
    });
  }

  if (version === CURRENT_SCHEMA_VERSION) {
    return success({ value: input, migrated: false });
  }

  if (version < 1) {
    return failure({
      code: "unsupported_older_schema",
      message: "지원하는 이전 스키마가 아닙니다.",
    });
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return failure({
      code: "unsupported_newer_schema",
      message: "이 앱보다 새로운 스키마 버전은 사용할 수 없습니다.",
    });
  }

  let migrated: unknown = input;
  let currentVersion = version;
  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(currentVersion);
    if (migration === undefined) {
      return failure({
        code: "unsupported_older_schema",
        message: "지원하는 마이그레이션 경로가 없습니다.",
      });
    }

    const result = migration(migrated);
    if (!result.ok) {
      return result;
    }
    migrated = result.value;
    currentVersion += 1;
  }

  return success({ value: migrated, migrated: true });
}
