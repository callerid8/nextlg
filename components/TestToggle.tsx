"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CircleGauge, Network } from "lucide-react";

interface testToggleProps {
  onToggle: (showSpeedTest: boolean) => void;
}

export function TestToggle({ onToggle }: testToggleProps) {
  const [showSpeedTest, setShowSpeedTest] = useState<boolean>(false);

  const handleToggle = () => {
    const newShowSpeedTest = !showSpeedTest;
    setShowSpeedTest(newShowSpeedTest);
    onToggle(newShowSpeedTest);
  };

  return (
    <Button variant="ghost" onClick={handleToggle} className="mx-2">
      <CircleGauge
        aria-label="Speed Tests"
        className={`${showSpeedTest ? "hidden" : "inline"}`}
      />
      <Network
        aria-label="Network Tests"
        className={`${showSpeedTest ? "inline" : "hidden"}`}
      />
    </Button>
  );
}
