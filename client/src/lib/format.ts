const DAY_MS = 24 * 60 * 60 * 1000;

export function italianDate(dateIso: string) {
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(
    new Date(dateIso)
  );
}

export function italianWeekday(date = new Date()) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long" }).format(date);
}

// "oggi", "domani", "fra 3 g." for a review date.
export function reviewLabel(dateIso?: string, now = new Date()) {
  if (!dateIso) return "";
  const days = Math.ceil((new Date(dateIso).getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "oggi";
  if (days === 1) return "domani";
  return `fra ${days} g.`;
}

export function romanNumeral(value: number) {
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let remaining = Math.max(1, Math.floor(value));
  let result = "";
  for (const [amount, symbol] of table) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

export function colophonDate(date = new Date()) {
  const dayMonth = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" }).format(date);
  return `${dayMonth} ${romanNumeral(date.getFullYear())}`;
}
