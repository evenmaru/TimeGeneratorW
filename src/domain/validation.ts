import {
  CURRENT_SCHEMA_VERSION,
  MAX_SLOT_COUNT,
  type AppState,
  type GeneratedTime,
  type ShellFormat,
  type Slot,
} from "./models";
import type { TimeZonePort } from "./ports/timeZonePort";
import { failure, success, type Result } from "./result";

export type ValidationIssueCode =
  | "expected_object"
  | "invalid_schema_version"
  | "unsupported_schema_version"
  | "expected_slots_array"
  | "too_many_slots"
  | "invalid_id"
  | "duplicate_id"
  | "invalid_name"
  | "normalized_name"
  | "invalid_date"
  | "invalid_date_range"
  | "invalid_time_zone"
  | "invalid_generated_time"
  | "normalized_generated_time"
  | "reset_invalid_generated_time"
  | "invalid_shell_format";

export type ValidationIssue = Readonly<{
  code: ValidationIssueCode;
  path: string;
  message: string;
}>;

export type ValidatedState = Readonly<{
  state: AppState;
  normalized: boolean;
  issues: readonly ValidationIssue[];
}>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const UTC_OFFSET_PATTERN = /^[+-](?:[01]\d|2[0-3]):[0-5]\d$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlainRecord = Record<string, unknown>;

type DateParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

type DateTimeParts = DateParts &
  Readonly<{
    hour: number;
    minute: number;
    second: number;
  }>;

export function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSlotName(
  value: unknown,
  path = "name",
): Result<string, ValidationIssue> {
  if (typeof value !== "string") {
    return failure(issue("invalid_name", path, "슬롯 이름은 문자열이어야 합니다."));
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return failure(issue("invalid_name", path, "슬롯 이름을 입력해야 합니다."));
  }

  return success(normalized);
}

export function isValidDate(value: unknown): value is string {
  return typeof value === "string" && parseDateParts(value) !== null;
}

export function isValidLocalDateTime(value: unknown): value is string {
  return typeof value === "string" && parseDateTimeParts(value) !== null;
}

export function isValidUtcOffset(value: unknown): value is string {
  return typeof value === "string" && UTC_OFFSET_PATTERN.test(value);
}

export function isWeekday(date: string): boolean {
  const parts = parseDateParts(date);
  if (parts === null) {
    return false;
  }

  const dateValue = new Date(0);
  dateValue.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  dateValue.setUTCHours(0, 0, 0, 0);
  const day = dateValue.getUTCDay();
  return day !== 0 && day !== 6;
}

export function validateDateRange(
  startDate: unknown,
  endDate: unknown,
  basePath = "dateRange",
): Result<Readonly<{ startDate: string; endDate: string }>, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!isValidDate(startDate)) {
    issues.push(issue("invalid_date", `${basePath}.startDate`, "올바른 시작일을 입력해야 합니다."));
  }

  if (!isValidDate(endDate)) {
    issues.push(issue("invalid_date", `${basePath}.endDate`, "올바른 종료일을 입력해야 합니다."));
  }

  if (issues.length > 0 || typeof startDate !== "string" || typeof endDate !== "string") {
    return failure(issues);
  }

  if (startDate > endDate) {
    return failure([
      issue(
        "invalid_date_range",
        basePath,
        "시작일은 종료일보다 늦을 수 없습니다.",
      ),
    ]);
  }

  return success({ startDate, endDate });
}

export function validateAndNormalizeAppState(
  input: unknown,
  timeZonePort: TimeZonePort,
): Result<ValidatedState, readonly ValidationIssue[]> {
  if (!isPlainRecord(input)) {
    return failure([
      issue("expected_object", "$", "애플리케이션 상태는 객체여야 합니다."),
    ]);
  }

  const rootIssues: ValidationIssue[] = [];
  const schemaVersion = input.schemaVersion;

  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    rootIssues.push(
      issue(
        "invalid_schema_version",
        "schemaVersion",
        "스키마 버전은 정수여야 합니다.",
      ),
    );
  } else if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    rootIssues.push(
      issue(
        "unsupported_schema_version",
        "schemaVersion",
        `지원하지 않는 스키마 버전입니다: ${schemaVersion}`,
      ),
    );
  }

  if (!Array.isArray(input.slots)) {
    rootIssues.push(
      issue("expected_slots_array", "slots", "슬롯 목록은 배열이어야 합니다."),
    );
  } else if (input.slots.length > MAX_SLOT_COUNT) {
    rootIssues.push(
      issue(
        "too_many_slots",
        "slots",
        `슬롯은 최대 ${MAX_SLOT_COUNT}개까지 저장할 수 있습니다.`,
      ),
    );
  }

  if (!isShellFormatOrNull(input.shellFormat)) {
    rootIssues.push(
      issue(
        "invalid_shell_format",
        "shellFormat",
        "지원하는 셸 형식이 아닙니다.",
      ),
    );
  }

  if (rootIssues.length > 0 || !Array.isArray(input.slots)) {
    return failure(rootIssues);
  }

  const slots: Slot[] = [];
  const issues: ValidationIssue[] = [];
  const fatalIssues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  input.slots.forEach((slotInput, index) => {
    const slotPath = `slots[${index}]`;
    const slotResult = validateAndNormalizeSlot(slotInput, slotPath, timeZonePort);

    if (!slotResult.ok) {
      fatalIssues.push(...slotResult.error);
      return;
    }

    const { slot, issues: slotIssues } = slotResult.value;
    if (seenIds.has(slot.id)) {
      fatalIssues.push(
        issue("duplicate_id", `${slotPath}.id`, "슬롯 ID가 중복되었습니다."),
      );
      return;
    }

    seenIds.add(slot.id);
    slots.push(slot);
    issues.push(...slotIssues);
  });

  if (fatalIssues.length > 0) {
    return failure(fatalIssues);
  }

  const state: AppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    slots,
    shellFormat: input.shellFormat as ShellFormat | null,
  };

  const normalized =
    issues.length > 0 ||
    hasUnknownKeys(input, ["schemaVersion", "slots", "shellFormat"]) ||
    input.slots.some((slotInput) =>
      isPlainRecord(slotInput)
        ? hasUnknownKeys(slotInput, [
            "id",
            "name",
            "startDate",
            "endDate",
            "timeZone",
            "lastGeneratedTime",
          ])
        : false,
    );

  return success({ state, normalized, issues });
}

function validateAndNormalizeSlot(
  input: unknown,
  path: string,
  timeZonePort: TimeZonePort,
): Result<Readonly<{ slot: Slot; issues: readonly ValidationIssue[] }>, readonly ValidationIssue[]> {
  if (!isPlainRecord(input)) {
    return failure([issue("expected_object", path, "슬롯은 객체여야 합니다.")]);
  }

  const fatalIssues: ValidationIssue[] = [];
  const normalizationIssues: ValidationIssue[] = [];

  if (typeof input.id !== "string" || !UUID_V4_PATTERN.test(input.id)) {
    fatalIssues.push(issue("invalid_id", `${path}.id`, "슬롯 ID 형식이 올바르지 않습니다."));
  }

  const nameResult = normalizeSlotName(input.name, `${path}.name`);
  if (!nameResult.ok) {
    fatalIssues.push(nameResult.error);
  } else if (nameResult.value !== input.name) {
    normalizationIssues.push(
      issue(
        "normalized_name",
        `${path}.name`,
        "슬롯 이름의 앞뒤 공백을 제거했습니다.",
      ),
    );
  }

  const dateRangeResult = validateDateRange(input.startDate, input.endDate, path);
  if (!dateRangeResult.ok) {
    fatalIssues.push(...dateRangeResult.error);
  }

  if (typeof input.timeZone !== "string" || !timeZonePort.isValidTimeZone(input.timeZone)) {
    fatalIssues.push(
      issue(
        "invalid_time_zone",
        `${path}.timeZone`,
        "유효한 IANA 시간대를 사용해야 합니다.",
      ),
    );
  }

  if (fatalIssues.length > 0) {
    return failure(fatalIssues);
  }

  const slotBase = {
    id: input.id as string,
    name: nameResult.ok ? nameResult.value : "",
    startDate: dateRangeResult.ok ? dateRangeResult.value.startDate : "",
    endDate: dateRangeResult.ok ? dateRangeResult.value.endDate : "",
    timeZone: input.timeZone as string,
  };

  let lastGeneratedTime: GeneratedTime | null = null;
  if (input.lastGeneratedTime !== null) {
    const generatedTimeResult = validateGeneratedTime(
      input.lastGeneratedTime,
      slotBase,
      `${path}.lastGeneratedTime`,
      timeZonePort,
    );

    if (generatedTimeResult.ok) {
      lastGeneratedTime = generatedTimeResult.value;
      if (
        isPlainRecord(input.lastGeneratedTime) &&
        hasUnknownKeys(input.lastGeneratedTime, ["localDateTime", "utcOffset"])
      ) {
        normalizationIssues.push(
          issue(
            "normalized_generated_time",
            `${path}.lastGeneratedTime`,
            "마지막 생성 시간의 알 수 없는 필드를 제거했습니다.",
          ),
        );
      }
    } else {
      normalizationIssues.push(
        issue(
          "reset_invalid_generated_time",
          `${path}.lastGeneratedTime`,
          "유효하지 않은 마지막 생성 시간을 초기화했습니다.",
        ),
      );
    }
  }

  return success({
    slot: { ...slotBase, lastGeneratedTime },
    issues: normalizationIssues,
  });
}

function validateGeneratedTime(
  input: unknown,
  slot: Pick<Slot, "startDate" | "endDate" | "timeZone">,
  path: string,
  timeZonePort: TimeZonePort,
): Result<GeneratedTime, ValidationIssue> {
  if (!isPlainRecord(input)) {
    return failure(
      issue("invalid_generated_time", path, "마지막 생성 시간은 객체여야 합니다."),
    );
  }

  const { localDateTime, utcOffset } = input;
  if (!isValidLocalDateTime(localDateTime) || !isValidUtcOffset(utcOffset)) {
    return failure(
      issue("invalid_generated_time", path, "마지막 생성 시간 형식이 올바르지 않습니다."),
    );
  }

  const date = localDateTime.slice(0, 10);
  const time = localDateTime.slice(11);
  if (
    date < slot.startDate ||
    date > slot.endDate ||
    !isWeekday(date) ||
    time < "09:00:00" ||
    time >= "23:00:00"
  ) {
    return failure(
      issue(
        "invalid_generated_time",
        path,
        "마지막 생성 시간이 슬롯의 생성 가능 범위 밖에 있습니다.",
      ),
    );
  }

  const validOffsets = timeZonePort.getValidUtcOffsets(localDateTime, slot.timeZone);
  if (!validOffsets.includes(utcOffset)) {
    return failure(
      issue(
        "invalid_generated_time",
        path,
        "마지막 생성 시간의 UTC 오프셋이 시간대와 일치하지 않습니다.",
      ),
    );
  }

  return success({ localDateTime, utcOffset });
}

function isShellFormatOrNull(value: unknown): value is ShellFormat | null {
  return value === null || value === "bash" || value === "powershell" || value === "cmd";
}

function parseDateParts(value: string): DateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function parseDateTimeParts(value: string): DateTimeParts | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const date = parseDateParts(`${yearText}-${monthText}-${dayText}`);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (date === null || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  return { ...date, hour, minute, second };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function hasUnknownKeys(record: PlainRecord, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).some((key) => !allowed.has(key));
}

function issue(
  code: ValidationIssueCode,
  path: string,
  message: string,
): ValidationIssue {
  return { code, path, message };
}
