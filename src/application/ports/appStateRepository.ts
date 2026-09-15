import type { AppState } from "../../domain/models";
import type { AppStateWriter } from "./appStateWriter";

export type StartupNoticeTone = "warning" | "error";

export type StartupNotice = Readonly<{
  code:
    | "state_normalized"
    | "state_recovered"
    | "recovery_copy_failed"
    | "storage_read_failed"
    | "normalization_save_failed"
    | "unsupported_newer_schema";
  tone: StartupNoticeTone;
  message: string;
}>;

export type AppStateLoadResult = Readonly<{
  state: AppState;
  notices: readonly StartupNotice[];
}>;

export interface AppStateRepository extends AppStateWriter {
  load(): AppStateLoadResult;
}
