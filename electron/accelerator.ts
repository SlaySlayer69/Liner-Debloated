// renderer shortcut strings -> electron accelerators (layout independent, cyrillic keys map to qwerty)
const CYRILLIC_TO_QWERTY: Record<string, string> = {
  "й": "Q", "ц": "W", "у": "E", "к": "R", "е": "T", "н": "Y", "г": "U", "ш": "I", "щ": "O", "з": "P", "х": "[", "ъ": "]",
  "ф": "A", "ы": "S", "в": "D", "а": "F", "п": "G", "р": "H", "о": "J", "л": "K", "д": "L", "ж": ";", "э": "'",
  "я": "Z", "ч": "X", "с": "C", "м": "V", "и": "B", "т": "N", "ь": "M", "б": ",", "ю": ".", "ё": "`",
  "і": "S", "ї": "]", "є": "'", "ґ": "\\",
};

export function normalizeShortcut(raw: string): string {
  if (!raw) return "";
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "control" || lower === "ctrl" || lower === "commandorcontrol") {
      normalized.push("Control");
    } else if (lower === "alt" || lower === "option") {
      normalized.push("Alt");
    } else if (lower === "shift") {
      normalized.push("Shift");
    } else if (lower === "command" || lower === "cmd" || lower === "meta") {
      normalized.push("Command");
    } else if (CYRILLIC_TO_QWERTY[lower]) {
      normalized.push(CYRILLIC_TO_QWERTY[lower]);
    } else if (lower === "space") {
      normalized.push("Space");
    } else if (lower === "plus" || lower === "+") {
      normalized.push("Plus");
    } else {
      normalized.push(part.toUpperCase());
    }
  }
  return normalized.join("+");
}
