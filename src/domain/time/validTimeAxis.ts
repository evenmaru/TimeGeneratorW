import { isValidDate, isValidLocalDateTime, isWeekday } from "../validation";

export const WORKDAY_START_SECONDS = 9 * 60 * 60;
export const WORKDAY_END_SECONDS_EXCLUSIVE = 23 * 60 * 60;
export const VALID_SECONDS_PER_WORKDAY =
  WORKDAY_END_SECONDS_EXCLUSIVE - WORKDAY_START_SECONDS;

export function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year ?? 0, (month ?? 1) - 1, day ?? 1);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

export function findFirstWeekday(startDate: string, endDate: string): string | null {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return null;
  }

  let date = startDate;
  while (date <= endDate) {
    if (isWeekday(date)) {
      return date;
    }
    date = addCalendarDays(date, 1);
  }

  return null;
}

export function getRemainingValidSeconds(
  localDateTime: string,
  endDate: string,
  cap = Number.POSITIVE_INFINITY,
): number {
  if (!isValidLocalDateTime(localDateTime) || !isValidDate(endDate)) {
    return 0;
  }

  const date = localDateTime.slice(0, 10);
  const secondIndex = getWorkdaySecondIndex(localDateTime.slice(11));
  if (secondIndex === null || !isWeekday(date) || date > endDate) {
    return 0;
  }

  let remaining = VALID_SECONDS_PER_WORKDAY - 1 - secondIndex;
  if (remaining >= cap) {
    return cap;
  }

  let cursor = addCalendarDays(date, 1);
  while (cursor <= endDate) {
    if (isWeekday(cursor)) {
      remaining += VALID_SECONDS_PER_WORKDAY;
      if (remaining >= cap) {
        return cap;
      }
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return remaining;
}

export function advanceOnValidTimeAxis(
  localDateTime: string,
  deltaSeconds: number,
  endDate: string,
): string | null {
  if (
    !Number.isInteger(deltaSeconds) ||
    deltaSeconds < 0 ||
    !isValidLocalDateTime(localDateTime) ||
    !isValidDate(endDate)
  ) {
    return null;
  }

  let date = localDateTime.slice(0, 10);
  const initialIndex = getWorkdaySecondIndex(localDateTime.slice(11));
  if (initialIndex === null || !isWeekday(date) || date > endDate) {
    return null;
  }

  const secondsLeftToday = VALID_SECONDS_PER_WORKDAY - 1 - initialIndex;
  if (deltaSeconds <= secondsLeftToday) {
    return `${date}T${formatWorkdaySecondIndex(initialIndex + deltaSeconds)}`;
  }

  let remainingDelta = deltaSeconds - secondsLeftToday - 1;
  date = addCalendarDays(date, 1);

  while (date <= endDate) {
    if (isWeekday(date)) {
      if (remainingDelta < VALID_SECONDS_PER_WORKDAY) {
        return `${date}T${formatWorkdaySecondIndex(remainingDelta)}`;
      }
      remainingDelta -= VALID_SECONDS_PER_WORKDAY;
    }
    date = addCalendarDays(date, 1);
  }

  return null;
}

export function getValidTimelineProgress(
  startDate: string,
  endDate: string,
  localDateTime: string | null,
): number | null {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return null;
  }

  const totalWeekdays = countWeekdaysInclusive(startDate, endDate);
  if (totalWeekdays === 0 || localDateTime === null) {
    return null;
  }

  const date = localDateTime.slice(0, 10);
  const secondIndex = getWorkdaySecondIndex(localDateTime.slice(11));
  if (
    !isValidLocalDateTime(localDateTime) ||
    secondIndex === null ||
    date < startDate ||
    date > endDate ||
    !isWeekday(date)
  ) {
    return null;
  }

  const weekdaysThroughCurrent = countWeekdaysInclusive(startDate, date);
  const currentCoordinate =
    (weekdaysThroughCurrent - 1) * VALID_SECONDS_PER_WORKDAY + secondIndex;
  const lastCoordinate = totalWeekdays * VALID_SECONDS_PER_WORKDAY - 1;
  return lastCoordinate === 0 ? 0 : currentCoordinate / lastCoordinate;
}

export function hasWeekday(startDate: string, endDate: string): boolean {
  return countWeekdaysInclusive(startDate, endDate) > 0;
}

export function countWeekdaysInclusive(startDate: string, endDate: string): number {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    return 0;
  }

  const totalDays = differenceInCalendarDays(startDate, endDate) + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  let weekdays = fullWeeks * 5;
  const remainingDays = totalDays % 7;
  let cursor = addCalendarDays(startDate, fullWeeks * 7);

  for (let index = 0; index < remainingDays; index += 1) {
    if (isWeekday(cursor)) {
      weekdays += 1;
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return weekdays;
}

function getWorkdaySecondIndex(time: string): number | null {
  const [hour, minute, second] = time.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }

  const seconds = (hour ?? 0) * 3600 + (minute ?? 0) * 60 + (second ?? 0);
  if (seconds < WORKDAY_START_SECONDS || seconds >= WORKDAY_END_SECONDS_EXCLUSIVE) {
    return null;
  }
  return seconds - WORKDAY_START_SECONDS;
}

function formatWorkdaySecondIndex(index: number): string {
  const seconds = WORKDAY_START_SECONDS + index;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return [hour, minute, second].map((value) => String(value).padStart(2, "0")).join(":");
}

function differenceInCalendarDays(startDate: string, endDate: string): number {
  return Math.round((toUtcDateValue(endDate) - toUtcDateValue(startDate)) / 86_400_000);
}

function toUtcDateValue(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year ?? 0, (month ?? 1) - 1, day ?? 1);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime();
}

function formatDate(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}
