import React, { useEffect, useState, useCallback } from "react";

interface OnboardingTourProps {
  onComplete: () => void;
}

interface TourStep {
  selector: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="schema-sidebar"]',
    title: "Schema Browser",
    description: "Browse your database here",
  },
  {
    selector: '[data-tour="sql-editor"]',
    title: "SQL Editor",
    description: "Write queries with AI autocomplete",
  },
  {
    selector: '[data-tour="ai-panel"]',
    title: "APEX AI Assistant",
    description: "Ask APEX anything about your data",
  },
  {
    selector: '[data-tour="graph-builder"]',
    title: "Graph Builder",
    description: "Build charts by dragging columns",
  },
  {
    selector: '[data-tour="plan-mode"]',
    title: "Plan Mode",
    description: "Control what AI can do automatically",
  },
];

interface TooltipPosition {
  top: number;
  left: number;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(true);

  const TOOLTIP_WIDTH = 260;
  const TOOLTIP_HEIGHT = 110;
  const MARGIN = 12;

  const reposition = useCallback(() => {
    const currentStep = TOUR_STEPS[step];
    const el = document.querySelector(currentStep.selector) as HTMLElement | null;
    if (!el) {
      // Element not found — center tooltip on screen
      setPosition({
        top: window.innerHeight / 2 - TOOLTIP_HEIGHT / 2,
        left: window.innerWidth / 2 - TOOLTIP_WIDTH / 2,
      });
      setHighlightRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    // Try to place below the target, then above, then right
    let top = rect.bottom + MARGIN;
    let left = rect.left;

    // Clamp horizontally
    if (left + TOOLTIP_WIDTH > window.innerWidth - MARGIN) {
      left = window.innerWidth - TOOLTIP_WIDTH - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;

    // If tooltip goes below viewport, place above
    if (top + TOOLTIP_HEIGHT > window.innerHeight - MARGIN) {
      top = rect.top - TOOLTIP_HEIGHT - MARGIN;
    }
    if (top < MARGIN) top = MARGIN;

    setPosition({ top, left });
  }, [step]);

  useEffect(() => {
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [reposition]);

  const handleComplete = () => {
    setVisible(false);
    onComplete();
  };

  const handleNext = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  };

  if (!visible) return null;

  const currentStep = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Highlight ring around target element */}
      {highlightRect && (
        <div
          className="fixed pointer-events-none z-[9998]"
          style={{
            top: highlightRect.top - 3,
            left: highlightRect.left - 3,
            width: highlightRect.width + 6,
            height: highlightRect.height + 6,
            outline: "2px solid #00d2ff",
            borderRadius: 4,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="fixed z-[9999] bg-zinc-800 border border-zinc-600 rounded-lg shadow-2xl"
        style={{
          top: position.top,
          left: position.left,
          width: TOOLTIP_WIDTH,
        }}
      >
        <div className="p-4 flex flex-col gap-3">
          {/* Step counter + title */}
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-semibold">{currentStep.title}</span>
            <span className="text-zinc-400 text-[10px]">
              {step + 1} / {TOUR_STEPS.length}
            </span>
          </div>

          {/* Description */}
          <p className="text-zinc-300 text-xs leading-relaxed">{currentStep.description}</p>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleComplete}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-3 py-1 rounded bg-[#00d2ff] text-black text-xs font-bold hover:opacity-90 transition-opacity"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
