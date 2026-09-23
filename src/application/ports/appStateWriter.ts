import type { AppState } from "../../domain/models";
import type { Result } from "../../domain/result";

export type StateWriteError = Readonly<{
  code: "save_failed" | "save_in_progress" | "revision_conflict";
  message: string;
  cause?: unknown;
}>;

export interface AppStateWriter {
  save(state: AppState): Promise<Result<void, StateWriteError>>;
}
