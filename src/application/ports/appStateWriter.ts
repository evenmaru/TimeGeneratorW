import type { AppState } from "../../domain/models";
import type { Result } from "../../domain/result";

export type StateWriteError = Readonly<{
  code: "save_failed";
  message: string;
  cause?: unknown;
}>;

export interface AppStateWriter {
  save(state: AppState): Result<void, StateWriteError>;
}
