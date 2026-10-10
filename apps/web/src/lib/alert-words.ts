import type { NumberFormatOptions } from "@magicmis/core/format";
import { formatValue, type AlertRule } from "@magicmis/render-dashboard";

/** An alert as the board and Files and settings show it: the rule, its figure's name and unit. */
export interface BoardAlert extends AlertRule {
  readonly label: string;
  readonly unit: "money" | "percent" | "ratio" | "days";
}

/** "Cash and bank balances below ₹5,00,000.00", "Debtor days above 60 days" (ADR 0087). */
export function alertWords(
  alert: BoardAlert,
  money: NumberFormatOptions,
  currencySymbol: string,
): string {
  const threshold =
    alert.unit === "money"
      ? formatValue(alert.threshold, "paise", money, currencySymbol)
      : alert.unit === "percent"
        ? `${alert.threshold}%`
        : alert.unit === "days"
          ? `${alert.threshold} days`
          : alert.threshold;
  return `${alert.label} ${alert.comparator === "below" ? "is below" : "is above"} ${threshold}`;
}
