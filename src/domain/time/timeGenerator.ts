import type { GeneratedTime, Slot } from "../models";
import type { RandomSource } from "../ports/randomSource";
import type { TimeZonePort } from "../ports/timeZonePort";
import { failure, success, type Result } from "../result";
import {
  advanceOnValidTimeAxis,
  findFirstWeekday,
  getRemainingValidSeconds,
} from "./validTimeAxis";

export const MIN_INTERVAL_SECONDS = 10 * 60;
export const MAX_INTERVAL_SECONDS = 3 * 60 * 60;
export const MAX_GENERATION_ATTEMPTS = 100;

const INITIAL_WINDOW_SECONDS = 31 * 60;

export type TimeGenerationErrorCode =
  | "no_available_time"
  | "temporary_generation_failure"
  | "time_zone_error";

export type TimeGenerationError = Readonly<{
  code: TimeGenerationErrorCode;
  message: string;
}>;

export function generateNextTime(
  slot: Slot,
  randomSource: RandomSource,
  timeZonePort: TimeZonePort,
): Result<GeneratedTime, TimeGenerationError> {
  if (!timeZonePort.isValidTimeZone(slot.timeZone)) {
    return failure(timeZoneError());
  }

  return slot.lastGeneratedTime === null
    ? generateInitialTime(slot, randomSource, timeZonePort)
    : generateSubsequentTime(slot, randomSource, timeZonePort);
}

function generateInitialTime(
  slot: Slot,
  randomSource: RandomSource,
  timeZonePort: TimeZonePort,
): Result<GeneratedTime, TimeGenerationError> {
  const firstWeekday = findFirstWeekday(slot.startDate, slot.endDate);
  if (firstWeekday === null) {
    return failure(noAvailableTime());
  }

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const secondResult = randomInteger(randomSource, 0, INITIAL_WINDOW_SECONDS - 1);
    if (!secondResult.ok) {
      return secondResult;
    }

    const localDateTime = `${firstWeekday}T${formatInitialTime(secondResult.value)}`;
    const offsets = getOffsetsSafely(localDateTime, slot.timeZone, timeZonePort);
    if (!offsets.ok) {
      return offsets;
    }
    if (offsets.value.length > 0) {
      return success({ localDateTime, utcOffset: offsets.value[0] ?? "+00:00" });
    }
  }

  return failure(temporaryFailure());
}

function generateSubsequentTime(
  slot: Slot,
  randomSource: RandomSource,
  timeZonePort: TimeZonePort,
): Result<GeneratedTime, TimeGenerationError> {
  const basis = slot.lastGeneratedTime;
  if (basis === null) {
    return failure(temporaryFailure());
  }

  const remainingSeconds = getRemainingValidSeconds(
    basis.localDateTime,
    slot.endDate,
    MAX_INTERVAL_SECONDS,
  );
  if (remainingSeconds < MIN_INTERVAL_SECONDS) {
    return failure(noAvailableTime());
  }

  const intervalUpperBound = Math.min(MAX_INTERVAL_SECONDS, remainingSeconds);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const intervalResult = randomInteger(
      randomSource,
      MIN_INTERVAL_SECONDS,
      intervalUpperBound,
    );
    if (!intervalResult.ok) {
      return intervalResult;
    }

    const localDateTime = advanceOnValidTimeAxis(
      basis.localDateTime,
      intervalResult.value,
      slot.endDate,
    );
    if (localDateTime === null) {
      return failure(temporaryFailure());
    }

    const offsets = getOffsetsSafely(localDateTime, slot.timeZone, timeZonePort);
    if (!offsets.ok) {
      return offsets;
    }
    if (offsets.value.length === 0) {
      continue;
    }

    const acceptanceProbability = getAcceptanceProbability(localDateTime.slice(11));
    if (acceptanceProbability !== null) {
      const acceptanceResult = readRandom(randomSource);
      if (!acceptanceResult.ok) {
        return acceptanceResult;
      }
      if (acceptanceResult.value >= acceptanceProbability) {
        continue;
      }
    }

    return success({
      localDateTime,
      utcOffset: offsets.value[0] ?? "+00:00",
    });
  }

  return failure(temporaryFailure());
}

function randomInteger(
  randomSource: RandomSource,
  minimum: number,
  maximum: number,
): Result<number, TimeGenerationError> {
  const randomResult = readRandom(randomSource);
  if (!randomResult.ok) {
    return randomResult;
  }

  return success(
    minimum + Math.floor(randomResult.value * (maximum - minimum + 1)),
  );
}

function readRandom(
  randomSource: RandomSource,
): Result<number, TimeGenerationError> {
  try {
    const value = randomSource.next();
    return Number.isFinite(value) && value >= 0 && value < 1
      ? success(value)
      : failure(temporaryFailure());
  } catch {
    return failure(temporaryFailure());
  }
}

function getOffsetsSafely(
  localDateTime: string,
  timeZone: string,
  timeZonePort: TimeZonePort,
): Result<readonly string[], TimeGenerationError> {
  try {
    return success(timeZonePort.getValidUtcOffsets(localDateTime, timeZone));
  } catch {
    return failure(timeZoneError());
  }
}

function getAcceptanceProbability(time: string): number | null {
  if (time >= "12:00:00" && time < "13:00:00") {
    return 0.2;
  }
  if (time >= "17:00:00" && time < "20:00:00") {
    return 0.25;
  }
  return null;
}

function formatInitialTime(secondIndex: number): string {
  const totalSeconds = 9 * 3600 + secondIndex;
  const hour = Math.floor(totalSeconds / 3600);
  const minute = Math.floor((totalSeconds % 3600) / 60);
  const second = totalSeconds % 60;
  return [hour, minute, second].map((value) => String(value).padStart(2, "0")).join(":");
}

function noAvailableTime(): TimeGenerationError {
  return {
    code: "no_available_time",
    message: "설정한 종료일까지 생성 가능한 다음 시간이 없습니다.",
  };
}

function temporaryFailure(): TimeGenerationError {
  return {
    code: "temporary_generation_failure",
    message: "이번 시도에서 시간을 정하지 못했습니다. 상태를 유지했으니 다시 시도해 주세요.",
  };
}

function timeZoneError(): TimeGenerationError {
  return {
    code: "time_zone_error",
    message: "슬롯의 시간대를 이 브라우저에서 처리할 수 없어 시간을 생성하지 못했습니다.",
  };
}
