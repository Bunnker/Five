import type { PingCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface PingColorCardProps {
  actionHref?: string | undefined;
  tier: PingCardData;
}

export function PingColorCard({ actionHref, tier }: PingColorCardProps) {
  return <DecisionColorCard actionHref={actionHref} tier={tier} />;
}
