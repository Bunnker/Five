import type { CiJiCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface CiJiColorCardProps {
  actionHref?: string | undefined;
  tier: CiJiCardData;
}

export function CiJiColorCard({ actionHref, tier }: CiJiColorCardProps) {
  return <DecisionColorCard actionHref={actionHref} tier={tier} />;
}
