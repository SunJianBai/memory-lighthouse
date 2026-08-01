import { Lightbulb } from "lucide-react";

export const BrandMark = ({ compact = false }: { compact?: boolean }) => (
  <div className="brand-mark" aria-label="守忆灯塔">
    <span className="brand-icon" aria-hidden="true">
      <Lightbulb size={compact ? 20 : 24} strokeWidth={2.2} />
    </span>
    <span className="brand-copy">
      <strong>守忆灯塔</strong>
      {!compact && <small>Memory Lighthouse</small>}
    </span>
  </div>
);
