import type { Result } from "../../domain/result";

export type BackupFileError = Readonly<{
  code: "file_read_failed" | "file_download_failed";
  message: string;
  cause?: unknown;
}>;

export interface BackupFilePort {
  readText(file: unknown): Promise<Result<string, BackupFileError>>;
  downloadText(
    fileName: string,
    content: string,
  ): Result<void, BackupFileError>;
}
