export interface TimeZonePort {
  getCurrentTimeZone(): string | null;
  isValidTimeZone(timeZone: string): boolean;
  getValidUtcOffsets(localDateTime: string, timeZone: string): readonly string[];
}
