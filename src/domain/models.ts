export const CURRENT_SCHEMA_VERSION = 1 as const;
export const MAX_SLOT_COUNT = 5;

export type ShellFormat = "bash" | "powershell" | "cmd";

export type GeneratedTime = Readonly<{
  localDateTime: string;
  utcOffset: string;
}>;

export type Slot = Readonly<{
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  lastGeneratedTime: GeneratedTime | null;
}>;

export type AppState = Readonly<{
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  slots: readonly Slot[];
  shellFormat: ShellFormat | null;
}>;

export function createInitialAppState(): AppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    slots: [],
    shellFormat: null,
  };
}
