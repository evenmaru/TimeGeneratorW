import { MAX_SLOT_COUNT, type AppState, type Slot } from "./models";
import { normalizeSlotName, validateDateRange } from "./validation";
import { failure, success, type Result } from "./result";

export type SlotCommandErrorCode =
  | "slot_limit_reached"
  | "invalid_name"
  | "invalid_date"
  | "invalid_date_range"
  | "invalid_time_zone"
  | "duplicate_id"
  | "slot_not_found"
  | "last_generated_time_out_of_range";

export type SlotCommandError = Readonly<{
  code: SlotCommandErrorCode;
  message: string;
  field?: "name" | "startDate" | "endDate";
}>;

export type CreateSlotInput = Readonly<{
  id: string;
  name: unknown;
  startDate: unknown;
  endDate: unknown;
  timeZone: string;
}>;

export type UpdateSlotInput = Readonly<{
  name: unknown;
  startDate: unknown;
  endDate: unknown;
  resetLastGeneratedTime: boolean;
}>;

export function createSlot(
  state: AppState,
  input: CreateSlotInput,
): Result<Readonly<{ state: AppState; slot: Slot }>, SlotCommandError> {
  if (state.slots.length >= MAX_SLOT_COUNT) {
    return failure({
      code: "slot_limit_reached",
      message: `슬롯은 최대 ${MAX_SLOT_COUNT}개까지 만들 수 있습니다.`,
    });
  }

  const nameResult = normalizeSlotName(input.name);
  if (!nameResult.ok) {
    return failure({
      code: "invalid_name",
      field: "name",
      message: nameResult.error.message,
    });
  }

  const dateResult = validateDateRange(input.startDate, input.endDate);
  if (!dateResult.ok) {
    return failure(toDateCommandError(dateResult.error));
  }

  if (input.timeZone.length === 0) {
    return failure({
      code: "invalid_time_zone",
      message: "브라우저에서 유효한 IANA 시간대를 확인할 수 없습니다.",
    });
  }

  if (state.slots.some((slot) => slot.id === input.id)) {
    return failure({
      code: "duplicate_id",
      message: "새 슬롯의 내부 ID가 기존 슬롯과 중복되었습니다.",
    });
  }

  const slot: Slot = {
    id: input.id,
    name: nameResult.value,
    startDate: dateResult.value.startDate,
    endDate: dateResult.value.endDate,
    timeZone: input.timeZone,
    lastGeneratedTime: null,
  };

  return success({
    state: { ...state, slots: [...state.slots, slot] },
    slot,
  });
}

export function updateSlot(
  state: AppState,
  slotId: string,
  input: UpdateSlotInput,
): Result<AppState, SlotCommandError> {
  const slotIndex = state.slots.findIndex((slot) => slot.id === slotId);
  if (slotIndex < 0) {
    return failure({ code: "slot_not_found", message: "변경할 슬롯을 찾을 수 없습니다." });
  }

  const nameResult = normalizeSlotName(input.name);
  if (!nameResult.ok) {
    return failure({
      code: "invalid_name",
      field: "name",
      message: nameResult.error.message,
    });
  }

  const dateResult = validateDateRange(input.startDate, input.endDate);
  if (!dateResult.ok) {
    return failure(toDateCommandError(dateResult.error));
  }

  const currentSlot = state.slots[slotIndex];
  if (currentSlot === undefined) {
    return failure({ code: "slot_not_found", message: "변경할 슬롯을 찾을 수 없습니다." });
  }

  const lastGeneratedDate = currentSlot.lastGeneratedTime?.localDateTime.slice(0, 10);
  const lastGeneratedTimeIsOutsideRange =
    lastGeneratedDate !== undefined &&
    (lastGeneratedDate < dateResult.value.startDate ||
      lastGeneratedDate > dateResult.value.endDate);

  if (lastGeneratedTimeIsOutsideRange && !input.resetLastGeneratedTime) {
    return failure({
      code: "last_generated_time_out_of_range",
      message: "새 날짜 범위에 마지막 생성 시간이 포함되지 않습니다.",
    });
  }

  const updatedSlot: Slot = {
    ...currentSlot,
    name: nameResult.value,
    startDate: dateResult.value.startDate,
    endDate: dateResult.value.endDate,
    lastGeneratedTime: lastGeneratedTimeIsOutsideRange
      ? null
      : currentSlot.lastGeneratedTime,
  };
  const slots = [...state.slots];
  slots[slotIndex] = updatedSlot;

  return success({ ...state, slots });
}

export function deleteSlot(
  state: AppState,
  slotId: string,
): Result<AppState, SlotCommandError> {
  if (!state.slots.some((slot) => slot.id === slotId)) {
    return failure({ code: "slot_not_found", message: "삭제할 슬롯을 찾을 수 없습니다." });
  }

  return success({
    ...state,
    slots: state.slots.filter((slot) => slot.id !== slotId),
  });
}

function toDateCommandError(
  issues: readonly Readonly<{ code: string; path: string; message: string }>[],
): SlotCommandError {
  const issue = issues[0];
  if (issue?.code === "invalid_date_range") {
    return { code: "invalid_date_range", message: issue.message };
  }

  const field = issue?.path.endsWith("startDate") ? "startDate" : "endDate";
  return {
    code: "invalid_date",
    field,
    message: issue?.message ?? "올바른 날짜를 입력해야 합니다.",
  };
}
