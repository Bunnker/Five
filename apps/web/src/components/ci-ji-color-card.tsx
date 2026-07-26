import type { CiJiCardData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface CiJiColorCardProps {
  tier: CiJiCardData;
}

export function CiJiColorCard({ tier }: CiJiColorCardProps) {
  return <DecisionColorCard tier={tier} />;
}
