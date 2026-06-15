import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterPaletteCommands,
  type PaletteCommand,
} from "../commands/paletteCommands";

type Props = {
  commands: PaletteCommand[];
};

export function CommandPalette({ commands }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => filterPaletteCommands(commands, query),
    [commands, query],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const execute = async (command: PaletteCommand | undefined) => {
    if (!command) {
      return;
    }
    setOpen(false);
    await command.run();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-overlay" role="presentation">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <input
          ref={inputRef}
          aria-label="Search commands"
          value={query}
          placeholder="Type a command..."
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) =>
                Math.min(current + 1, filtered.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              void execute(filtered[selected]);
            }
          }}
        />
        <div className="command-palette__list" role="listbox">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onClick={() => void execute(command)}
            >
              <span>{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="command-palette__empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
