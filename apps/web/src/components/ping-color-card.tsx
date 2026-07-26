import type { PingCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface PingColorCardProps {
  tier: PingCardData;
}

export function PingColorCard({ tier }: PingColorCardProps) {
  return <DecisionColorCard tier={tier} />;
}
