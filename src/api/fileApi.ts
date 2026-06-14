import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const TEXT_FILTERS = [
  {
    name: "Text and source files",
    extensions: [
      "txt",
      "md",
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "rs",
      "py",
      "yaml",
      "yml",
      "toml",
    ],
  },
];

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke("write_text_file", { path, content });
}

export type FileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export function readDirectory(path: string): Promise<FileTreeNode[]> {
  return invoke<FileTreeNode[]>("read_dir", { path });
}

export async function chooseTextFile(): Promise<string | undefined> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: TEXT_FILTERS,
  });
  return typeof path === "string" ? path : undefined;
}

export async function chooseFolder(): Promise<string | undefined> {
  const path = await open({
    multiple: false,
    directory: true,
  });
  return typeof path === "string" ? path : undefined;
}

export async function chooseSavePath(
  defaultPath?: string,
): Promise<string | undefined> {
  const path = await save({
    defaultPath,
    filters: TEXT_FILTERS,
  });
  return path ?? undefined;
}
