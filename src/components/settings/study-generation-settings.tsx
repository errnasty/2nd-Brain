"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import {
  DEFAULT_FLASHCARD_COUNT,
  DEFAULT_QUIZ_COUNT,
  DEFAULT_STUDY_DIFFICULTY,
  FLASHCARD_COUNT_RANGE,
  QUIZ_COUNT_RANGE,
  type StudyDifficulty,
} from "@/lib/ai/study-options";
import { Row } from "./settings-form";

const DIFFICULTIES: { id: StudyDifficulty; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

function DifficultyPicker({
  value,
  onChange,
}: {
  value: StudyDifficulty;
  onChange: (d: StudyDifficulty) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
      {DIFFICULTIES.map((d) => (
        <button
          key={d.id}
          onClick={() => onChange(d.id)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            value === d.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

function CountStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon"
        variant="outline"
        className="h-7 w-7"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <Button
        size="icon"
        variant="outline"
        className="h-7 w-7"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

type Prefs = {
  flashcardDifficulty?: StudyDifficulty;
  flashcardCount?: number;
  quizDifficulty?: StudyDifficulty;
  quizCount?: number;
};

/** Difficulty + length preferences for AI-generated flashcards and quizzes —
 *  synced (via the same user_settings blob as WIP limits etc.), so they apply
 *  everywhere cards/quizzes are made: a document's toolbar, the Directory's
 *  bulk "Quiz" action, and the Study hub's quiz picker. */
export function StudyGenerationSettings({ initial }: { initial: Prefs }) {
  const [flashcardDifficulty, setFlashcardDifficulty] = useState(
    initial.flashcardDifficulty ?? DEFAULT_STUDY_DIFFICULTY,
  );
  const [flashcardCount, setFlashcardCount] = useState(initial.flashcardCount ?? DEFAULT_FLASHCARD_COUNT);
  const [quizDifficulty, setQuizDifficulty] = useState(initial.quizDifficulty ?? DEFAULT_STUDY_DIFFICULTY);
  const [quizCount, setQuizCount] = useState(initial.quizCount ?? DEFAULT_QUIZ_COUNT);

  function save(patch: Prefs) {
    updateUserSettingsAction(patch).catch((err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't save your preference"),
    );
  }

  return (
    <section className="pt-4">
      <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Flashcards &amp; Quiz
      </h2>

      <Row title="Flashcard difficulty" desc="How much inference vs. plain recall new flashcards test.">
        <DifficultyPicker
          value={flashcardDifficulty}
          onChange={(d) => {
            setFlashcardDifficulty(d);
            save({ flashcardDifficulty: d });
          }}
        />
      </Row>

      <Separator />

      <Row title="Flashcard length" desc="How many cards to generate per document.">
        <CountStepper
          value={flashcardCount}
          min={FLASHCARD_COUNT_RANGE.min}
          max={FLASHCARD_COUNT_RANGE.max}
          onChange={(n) => {
            setFlashcardCount(n);
            save({ flashcardCount: n });
          }}
        />
      </Row>

      <Separator />

      <Row title="Quiz difficulty" desc="How much inference vs. plain recall new quizzes test.">
        <DifficultyPicker
          value={quizDifficulty}
          onChange={(d) => {
            setQuizDifficulty(d);
            save({ quizDifficulty: d });
          }}
        />
      </Row>

      <Separator />

      <Row title="Quiz length" desc="How many questions to generate per quiz.">
        <CountStepper
          value={quizCount}
          min={QUIZ_COUNT_RANGE.min}
          max={QUIZ_COUNT_RANGE.max}
          onChange={(n) => {
            setQuizCount(n);
            save({ quizCount: n });
          }}
        />
      </Row>
    </section>
  );
}
