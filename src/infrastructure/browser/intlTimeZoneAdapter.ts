import type { TimeZonePort } from "../../domain/ports/timeZonePort";
import { isValidLocalDateTime } from "../../domain/validation";

const SAMPLE_RANGE_HOURS = 36;
const SAMPLE_INTERVAL_HOURS = 6;
const MILLISECONDS_PER_HOUR = 3_600_000;

type LocalDateTimeParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

export class IntlTimeZoneAdapter implements TimeZonePort {
  private readonly localFormatters = new Map<string, Intl.DateTimeFormat>();
  private readonly offsetFormatters = new Map<string, Intl.DateTimeFormat>();

  public getCurrentTimeZone(): string | null {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.length > 0 ? timeZone : null;
  }

  public isValidTimeZone(timeZone: string): boolean {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
      return true;
    } catch {
      return false;
    }
  }

  public getValidUtcOffsets(localDateTime: string, timeZone: string): readonly string[] {
    if (!isValidLocalDateTime(localDateTime) || !this.isValidTimeZone(timeZone)) {
      return [];
    }

    const desiredParts = parseLocalDateTime(localDateTime);
    if (desiredParts === null) {
      return [];
    }

    const naiveUtc = toUtcMilliseconds(desiredParts);
    const possibleOffsetMilliseconds = new Set<number>();

    for (
      let hourDelta = -SAMPLE_RANGE_HOURS;
      hourDelta <= SAMPLE_RANGE_HOURS;
      hourDelta += SAMPLE_INTERVAL_HOURS
    ) {
      const offset = this.getOffsetMilliseconds(
        naiveUtc + hourDelta * MILLISECONDS_PER_HOUR,
        timeZone,
      );
      if (offset !== null) {
        possibleOffsetMilliseconds.add(offset);
      }
    }

    return [...possibleOffsetMilliseconds]
      .map((offsetMilliseconds) => ({
        instant: naiveUtc - offsetMilliseconds,
        offsetMilliseconds,
      }))
      .filter(({ instant }) =>
        localPartsEqual(this.getLocalParts(instant, timeZone), desiredParts),
      )
      .sort((left, right) => left.instant - right.instant)
      .map(({ offsetMilliseconds }) => formatUtcOffset(offsetMilliseconds));
  }

  private getLocalParts(instant: number, timeZone: string): LocalDateTimeParts | null {
    let formatter = this.localFormatters.get(timeZone);
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      this.localFormatters.set(timeZone, formatter);
    }

    const values = Object.fromEntries(
      formatter
        .formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const parts = {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    };

    return Object.values(parts).every(Number.isInteger) ? parts : null;
  }

  private getOffsetMilliseconds(instant: number, timeZone: string): number | null {
    let formatter = this.offsetFormatters.get(timeZone);
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      });
      this.offsetFormatters.set(timeZone, formatter);
    }

    const label = formatter
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;

    if (label === "GMT") {
      return 0;
    }

    const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(label ?? "");
    if (match === null || (match[4] !== undefined && match[4] !== "00")) {
      return null;
    }

    const sign = match[1] === "+" ? 1 : -1;
    return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  }
}

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

function toUtcMilliseconds(parts: LocalDateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function localPartsEqual(
  actual: LocalDateTimeParts | null,
  expected: LocalDateTimeParts,
): boolean {
  return (
    actual !== null &&
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second
  );
}

function formatUtcOffset(offsetMilliseconds: number): string {
  const sign = offsetMilliseconds >= 0 ? "+" : "-";
  const totalMinutes = Math.abs(offsetMilliseconds) / 60_000;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
