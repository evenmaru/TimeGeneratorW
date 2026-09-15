import type { Result } from "../../domain/result";

export type ClipboardError = Readonly<{
  code: "clipboard_failed";
  message: string;
  cause?: unknown;
}>;

export interface ClipboardPort {
  writeText(value: string): Promise<Result<void, ClipboardError>>;
}
