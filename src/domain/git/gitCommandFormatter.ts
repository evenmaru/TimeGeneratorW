import type { GeneratedTime, ShellFormat } from "../models";

export const COMMIT_MESSAGE_PLACEHOLDER = "<커밋 메시지>";

export function formatGitDate(generatedTime: GeneratedTime): string {
  return `${generatedTime.localDateTime}${generatedTime.utcOffset}`;
}

export function formatGitCommand(
  generatedTime: GeneratedTime,
  shellFormat: ShellFormat,
): string {
  const date = formatGitDate(generatedTime);

  switch (shellFormat) {
    case "bash":
      return `GIT_AUTHOR_DATE=${quoteBash(date)} GIT_COMMITTER_DATE=${quoteBash(date)} git commit -m ${quoteBash(COMMIT_MESSAGE_PLACEHOLDER)}`;
    case "powershell":
      return `$env:GIT_AUTHOR_DATE = ${quotePowerShell(date)}; $env:GIT_COMMITTER_DATE = ${quotePowerShell(date)}; git commit -m ${quotePowerShell(COMMIT_MESSAGE_PLACEHOLDER)}`;
    case "cmd":
      return `set "GIT_AUTHOR_DATE=${escapeCmdValue(date)}" && set "GIT_COMMITTER_DATE=${escapeCmdValue(date)}" && git commit -m "${escapeCmdValue(COMMIT_MESSAGE_PLACEHOLDER)}"`;
  }
}

export function quoteBash(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function escapeCmdValue(value: string): string {
  return value.replaceAll("%", "%%").replaceAll('"', '""');
}
