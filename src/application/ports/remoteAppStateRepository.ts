import type { AppState } from "../../domain/models";
import type { Result } from "../../domain/result";
import type { Unsubscribe } from "./authGateway";

export type RemoteAppState = Readonly<{
  state: AppState;
  revision: number;
}>;

export type RemoteStateError = Readonly<{
  code:
    | "load_failed"
    | "save_failed"
    | "revision_conflict"
    | "invalid_remote_state"
    | "subscription_failed";
  message: string;
  cause?: unknown;
}>;

export interface RemoteAppStateRepository {
  load(userId: string): Promise<Result<RemoteAppState | null, RemoteStateError>>;
  save(
    userId: string,
    state: AppState,
    expectedRevision: number | null,
  ): Promise<Result<number, RemoteStateError>>;
  subscribe(
    userId: string,
    onChange: (value: RemoteAppState | null) => void,
    onError: (error: RemoteStateError) => void,
  ): Unsubscribe;
}
