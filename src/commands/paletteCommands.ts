export type PaletteCommand = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

export function filterPaletteCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return commands;
  }
  return commands.filter((command) => {
    const label = command.label.toLowerCase();
    return terms.every((term) => label.includes(term));
  });
}
