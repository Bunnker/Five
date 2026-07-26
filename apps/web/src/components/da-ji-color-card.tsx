import type { DaJiCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface DaJiColorCardProps {
  tier: DaJiCardData;
}

export function DaJiColorCard({ tier }: DaJiColorCardProps) {
  return <DecisionColorCard tier={tier} />;
}
