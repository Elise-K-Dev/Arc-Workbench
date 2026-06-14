export type PatchLine = {
  type: "context" | "add" | "remove";
  content: string;
  oldLine?: number;
  newLine?: number;
};

export type PatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;
  lines: PatchLine[];
};

export type PatchFile = {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
  isNewFile?: boolean;
  isDeletedFile?: boolean;
  isRename?: boolean;
};

export type ParsedPatch = {
  raw: string;
  files: PatchFile[];
};

export type ExtractedPatch = {
  raw: string;
  parsed?: ParsedPatch;
  error?: string;
};
