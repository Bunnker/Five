import type { DaJiCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface DaJiColorCardProps {
  actionHref?: string | undefined;
  tier: DaJiCardData;
}

export function DaJiColorCard({ actionHref, tier }: DaJiColorCardProps) {
  return <DecisionColorCard actionHref={actionHref} tier={tier} />;
}
